"""
F0 数据管道 — 管道编排器 (Pipeline)

这是 OmniThings 的心脏。
每一条 MQTT 消息都流经此管道:
  RawMessage → [Hook1 解析] → [Hook2 归一化] → [Hook3 存储] → [CE 透传骨架]

CE 三条路径 (方案B):
  Path A: SymPy 公式计算 → F1 激活时工作, 当前 no-op
  Path B: CAGG 窗口聚合   → TSDB 内置, 零 Python 代码
  Path C: 跨节点 SQL 聚合   → APScheduler Job, 当前 no-op

设计原则:
  - 单线程异步 (asyncio), 无锁
  - 每个 Hook 可独立插拔
  - metrics 全程可观测
  - 异常不传播: Hook 失败跳过, 记录日志, 继续下一条
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from loguru import logger

from app.core.config import settings
from app.models.schemas import (
    NormalizedMessage,
    ParsedMessage,
    PipelineMetrics,
    PipelineStatus,
    RawMessage,
)
from app.services.mqtt_client import MqttClient
from app.services.normalizer import TagNormalizationRule, normalize
from app.services.parser import parse_neuron_json
from app.services.telemetry_store import batch_insert_snapshots, batch_insert_telemetry, upsert_telemetry_latest, TelemetryRecord


class DataPipeline:
    """
    F0 数据管道。

    用法:
        pipeline = DataPipeline()
        await pipeline.start()     # 启动 MQTT + 加载规则
        ...                        # 自动消费消息
        await pipeline.stop()      # 优雅停更
    """

    def __init__(self) -> None:
        # ---- 组件 ----
        self._mqtt: MqttClient | None = None
        self._rules: dict[str, TagNormalizationRule] = {}  # {tag_name: rule}
        self._node_id_map: dict[str, UUID] = {}            # {node_name: node_id}
        self._tag_id_map: dict[str, UUID] = {}             # {tag_name: tag_id}

        # ---- Metrics ----
        self.metrics = PipelineMetrics()
        self._started_at: datetime | None = None

        # ---- 批量写入缓冲 ----
        self._buffer: list[TelemetryRecord] = []
        self._snapshot_buffer: list[NodeSnapshotRecord] = []
        self._buffer_lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None

        # ---- 节点状态缓存 (全量快照) ----
        # {node_name: {tag_name: (eng_value, raw_value)}}
        self._node_state: dict[str, dict[str, tuple[float | int | bool | str | None, float | int | bool | str | None]]] = {}

    # ══════════════════════════════
    # 生命周期
    # ══════════════════════════════

    async def start(self) -> None:
        """启动管道。"""
        logger.info("[Pipeline] Starting F0 data pipeline ...")
        self.metrics.status = PipelineStatus.STARTING
        self._started_at = datetime.now(timezone.utc)

        # Step 1: 初始化 DB 连接池
        from app.services.telemetry_store import init_db_pool

        init_db_pool(
            min_conn=settings.db_pool_min,
            max_conn=settings.db_pool_max,
        )

        # Step 2: 加载归一化规则和 ID 映射
        await self._load_tag_rules()

        # Step 3: 启动 MQTT 客户端
        self._mqtt = MqttClient(on_message_callback=self.on_message)
        await self._mqtt.start()

        # Step 4: 启动批量写入 flush 定时任务
        self._flush_task = asyncio.create_task(self._periodic_flush())

        self.metrics.status = PipelineStatus.RUNNING
        logger.success(
            "[Pipeline] F0 pipeline running ✅  rules={}, nodes={}, tags={}",
            len(self._rules),
            len(self._node_id_map),
            len(self._tag_id_map),
        )

    async def stop(self) -> None:
        """优雅停止。"""
        logger.info("[Pipeline] Stopping F0 data pipeline ...")
        self.metrics.status = PipelineStatus.STOPPING

        # 停止 flush task
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # 最后一次 flush
        if self._buffer:
            await self._do_flush()

        # 断开 MQTT
        if self._mqtt:
            await self._mqtt.stop()

        # 关闭连接池
        from app.services.telemetry_store import close_db_pool

        close_db_pool()

        self.metrics.status = PipelineStatus.STOPPED
        logger.info("[Pipeline] F0 pipeline stopped")

    # ══════════════════════════════
    # 核心处理函数 — 每条消息的入口
    # ══════════════════════════════

    async def on_message(self, mqtt_msg) -> None:
        """
        MQTT 消息回调 → 管道入口。

        整个 F0 的消息流转在此函数中完成。
        """
        self.metrics.messages_received += 1
        self.metrics.last_message_at = datetime.now(timezone.utc)

        raw = RawMessage(
            topic=mqtt_msg.topic,
            payload=mqtt_msg.payload,
            qos=mqtt_msg.qos,
        )

        # ── Hook 1: 解析 (~30 行) ──
        parsed = parse_neuron_json(raw)
        if parsed is None:
            self.metrics.messages_parse_error += 1
            return  # 跳过无法解析的消息
        self.metrics.messages_parsed_ok += 1

        # ── Hook 2: 归一化 (~40 行) ──
        normalized = normalize(parsed, rules=self._rules)
        self.metrics.points_normalized += normalized.point_count

        # 填充 node_id (延迟解析时保留的 node_name 需要映射回 node_id)
        for point in normalized.points:
            point.node_name = parsed.node_name

        # ── Hook 3: 持久化 (缓冲写入) (~30 行) ──
        records = self._to_records(normalized)
        snapshot = self._to_snapshot(normalized, parsed)
        should_flush = False
        async with self._buffer_lock:
            self._buffer.extend(records)
            self._snapshot_buffer.append(snapshot)
            should_flush = len(self._buffer) >= settings.pipeline_batch_size

        if should_flush:
            await self._do_flush()

        # ══════════════════════════════════════
        # CE 三条路径 (按需激活, F0 阶段全部透传)
        # ══════════════════════════════════════

        # ── CE Path A: SymPy 公式计算 (F1 核心) ──
        # 当前: no-op（无公式注册）
        # F1 激活后: dispatch_logical_triggers(normalized)
        # await self._ce_path_a_formula(normalized)

        # ── CE Path B: CAGG 窗口聚合 (TSDB 内置) ──
        # 当前: 已在 SQL 层自动运行 (CREATE MATERIALIZED VIEW WITH continuous)
        # 无需任何 Python 代码干预

        # ── CE Path C: 跨节点 SQL 聚合 (F3 汇总) ──
        # 当前: no-op（无节点树）
        # F3 激活后: APScheduler Job 每 10s 执行 GROUP BY

    # ══════════════════════════════
    # CE 路径预留 (F1/F3 激活后实现)
    # ══════════════════════════════

    async def _ce_path_a_formula(self, normalized: NormalizedMessage) -> None:
        """
        CE Path A: SymPy 公式计算 (F1 VirtualPointEngine)。

        触发条件: 变化的 tag 是某个 LogicalTag formula 的 source。
        实现: 在 Phase 2 S6 中补全。
        """
        # TODO Phase 2 S6:
        # from app.services.virtual_point_engine import VirtualPointEngine
        # virtual_points = await VirtualPointEngine.instance().evaluate(normalized)
        # if virtual_points:
        #     records = self._to_records_from_virtual(virtual_points)
        #     async with self._buffer_lock:
        #         self._buffer.extend(records)
        pass

    # ══════════════════════════════
    # 辅助方法
    # ══════════════════════════════

    def _to_records(self, msg: NormalizedMessage) -> list[TelemetryRecord]:
        """NormalizedMessage → TelemetryRecord[] (需要 ID 映射)."""
        records: list[TelemetryRecord] = []
        for point in msg.points:
            nid = self._node_id_map.get(point.node_name or msg.source_node)
            tid = self._tag_id_map.get(point.tag_name)
            if nid is not None and tid is not None:
                records.append(TelemetryRecord.from_point(point, nid, tid))
            else:
                logger.debug(
                    "[Pipeline] Unresolved: node={} tag={}",
                    point.node_name or msg.source_node,
                    point.tag_name,
                )
        return records

    def _to_snapshot(self, msg: NormalizedMessage, parsed: ParsedMessage) -> NodeSnapshotRecord:
        """
        NormalizedMessage → NodeSnapshotRecord (数据黑板)。

        时间戳对齐: 使用 parsed.timestamp (Neuron 原始时间戳)。
        全量快照: 合并节点状态缓存，生成包含所有点位的完整快照。
        """
        from app.models.schemas import NodeSnapshotRecord

        node_name = msg.source_node
        node_id = self._node_id_map.get(node_name)
        if node_id is None:
            # 未知节点，使用零 UUID (会在 DB 层被拒绝，仅作占位)
            node_id = UUID(int=0)

        # 初始化节点状态缓存
        if node_name not in self._node_state:
            self._node_state[node_name] = {}

        state = self._node_state[node_name]

        # 更新缓存: 新值覆盖旧值
        for point in msg.points:
            raw_val = parsed.tags.get(point.tag_name)
            state[point.tag_name] = (point.value, raw_val)

        # 生成全量快照 (从缓存读取所有点位)
        data: dict[str, float | int | bool | str | None] = {}
        raw_data: dict[str, float | int | bool | str | None] = {}

        for tag_name, (eng_val, raw_val) in state.items():
            data[tag_name] = eng_val
            raw_data[tag_name] = raw_val

        return NodeSnapshotRecord(
            ts=msg.ts,
            node_id=node_id,
            node_name=node_name,
            data=data,
            raw_data=raw_data,
            raw_message=parsed.model_dump(),
            quality=192,
        )

    async def _load_tag_rules(self) -> None:
        """从 t_tags 表加载归一化规则和 ID 映射。"""
        try:
            from app.services.telemetry_store import get_connection

            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT t.name AS tag_name,
                               n.name AS node_name,
                               t.id AS tag_id,
                               n.id AS node_id,
                               t.data_type,
                               t.scale_factor,
                               t.value_offset,
                               t.unit_from,
                               t.unit_to,
                               t.range_min,
                               t.range_max
                        FROM t_tags t
                        JOIN t_nodes n ON t.node_id = n.id
                        WHERE t.enabled = true AND n.enabled = true;
                    """)
                    rows = cur.fetchall()

            self._rules.clear()
            self._node_id_map.clear()
            self._tag_id_map.clear()

            for row in rows:
                (tag_name, node_name, tag_id, node_id, data_type,
                 scale_factor, offset, unit_from, unit_to, range_min, range_max) = row

                # 归一化规则
                self._rules[tag_name] = TagNormalizationRule(
                    tag_name=tag_name,
                    data_type=data_type,
                    scale_factor=scale_factor or 1.0,
                    offset=offset or 0.0,
                    unit_from=unit_from,
                    unit_to=unit_to,
                    range_min=range_min,
                    range_max=range_max,
                )
                # ID 映射
                self._node_id_map[node_name] = node_id
                self._tag_id_map[tag_name] = tag_id

            logger.info("[Pipeline] Loaded {} tag rules", len(self._rules))

        except Exception as e:
            logger.warning("[Pipeline] Failed to load tag rules (DB may not be ready): {}", e)

    async def _periodic_flush(self) -> None:
        """定时 flush 缓冲区到 DB。"""
        while True:
            await asyncio.sleep(settings.pipeline_flush_interval_sec)
            if self._buffer or self._snapshot_buffer:
                await self._do_flush()

    async def _do_flush(self) -> None:
        """执行实际写入 (t_telemetry + t_node_snapshot)。"""
        if not self._buffer and not self._snapshot_buffer:
            return
        async with self._buffer_lock:
            batch = self._buffer[:]
            self._buffer.clear()
            snapshot_batch = self._snapshot_buffer[:]
            self._snapshot_buffer.clear()
        try:
            if batch:
                count = await batch_insert_telemetry(batch)
                self.metrics.points_written_db += count
                await upsert_telemetry_latest(batch)
            if snapshot_batch:
                await batch_insert_snapshots(snapshot_batch)
        except Exception as e:
            self.metrics.db_write_errors += 1
            logger.error("[Pipeline] DB write error ({} records, {} snapshots): {}",
                        len(batch), len(snapshot_batch), e)

    @property
    def uptime_seconds(self) -> float:
        if self._started_at:
            return (datetime.now(timezone.utc) - self._started_at).total_seconds()
        return 0.0
