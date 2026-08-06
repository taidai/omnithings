"""
ZiZu 标准全局实体单一数据源 (Single Source of Truth)
=====================================================
依据《光储充管理平台标准字段清单》(2026-05-22) 建模，覆盖：
  基础元数据 / 光伏 / 储能(含PCS) / 充电桩 / 电网侧 / 环境气象 /
  能量管理调度 / 安全保护 / 交易计费。

设计原则：
  - 保留原有 38 个实体 name 不变，保证既有绑定与规则兼容；
  - 仅在 ON CONFLICT 时更新 description/std_field/std_ref/is_system，
    不覆盖用户对 display_name/unit/entity_type/data_type/category/enabled 的定制；
  - 全部标记 is_system=TRUE（标准目录，不可删除，可禁用）；
  - std_field 回溯文档字段名，std_ref 回溯标准号，便于导入导出对齐。
  - 裁剪：纯标识符、交易流水、运维工单、审计日志、遥测元定义等非实时字段未纳入
    （文档本身允许按项目裁剪）。
"""
from __future__ import annotations

from typing import Any

# (name, display_name, entity_type, data_type, unit, category, description, std_field, std_ref)
STANDARD_ENTITIES: list[tuple[Any, ...]] = [
    # ── 基础元数据 / 站点参数 (section 1) ──
    ("station.installedCapacityPv", "光伏装机容量", "RW", "FLOAT", "kWp", "station", "光伏装机容量", "installed_capacity_pv", "GB/T 19963"),
    ("station.installedCapacityEss", "储能装机容量", "RW", "FLOAT", "kWh", "station", "储能装机容量(功率/容量)", "installed_capacity_ess", "GB/T 36547"),
    ("station.installedCapacityEvse", "充电桩总装机功率", "RW", "FLOAT", "kW", "station", "充电桩总装机功率", "installed_capacity_evse", "GB/T 18487.1"),
    ("station.gridConnectionVoltage", "并网电压等级", "R", "FLOAT", "kV", "station", "并网电压等级", "grid_connection_voltage", "GB/T 19963"),
    ("station.gridConnectionType", "并网类型", "R", "INT", None, "station", "并网类型(自发自用/余电上网/全额上网)", "grid_connection_type", "GB/T 19963"),
    ("station.status", "站点运行状态", "R", "INT", None, "station", "站点运行状态(运行/停机/检修/待调试)", "station_status", "GB/T 36558"),

    # ── 光伏 PV (section 2) — 原 13 + 新增 ──
    ("pv.activePower", "光伏有功功率", "R", "FLOAT", "kW", "pv", "光伏总有功功率", "pv_total_power", "GB/T 19963"),
    ("pv.reactivePower", "光伏无功功率", "R", "FLOAT", "kVar", "pv", "光伏无功功率", "pv_inverter_reactive_power", "GB/T 19963"),
    ("pv.powerFactor", "光伏功率因数", "R", "FLOAT", None, "pv", "光伏功率因数", "pv_inverter_power_factor", "GB/T 19963"),
    ("pv.voltage", "光伏并网电压", "R", "FLOAT", "V", "pv", "光伏并网三相电压", "pv_inverter_ac_voltage", "GB/T 19963"),
    ("pv.current", "光伏并网电流", "R", "FLOAT", "A", "pv", "光伏并网三相电流", "pv_inverter_ac_current", "GB/T 19963"),
    ("pv.frequency", "光伏并网频率", "R", "FLOAT", "Hz", "pv", "光伏并网频率", "pv_inverter_frequency", "GB/T 19963"),
    ("pv.irradiance", "光伏辐照度", "R", "FLOAT", "W/m²", "pv", "光伏辐照度", "pv_irradiance", "IEC 61724"),
    ("pv.moduleTemp", "组件温度", "R", "FLOAT", "°C", "pv", "组件背板温度", "pv_module_temperature", "IEC 61724"),
    ("pv.ambientTemp", "环境温度", "R", "FLOAT", "°C", "pv", "环境温度", "ambient_temperature", "IEC 61724"),
    ("pv.dailyEnergy", "光伏日发电量", "R", "FLOAT", "kWh", "pv", "光伏日发电量", "pv_total_daily_yield", "IEC 61724"),
    ("pv.totalEnergy", "光伏累计发电量", "R", "FLOAT", "kWh", "pv", "光伏累计发电量", "pv_total_yield", "IEC 61724"),
    ("pv.status", "逆变器状态", "R", "INT", None, "pv", "逆变器运行状态", "pv_inverter_status", "GB/T 19963"),
    ("pv.faultCode", "光伏故障代码", "R", "STRING", None, "pv", "光伏故障代码", "pv_inverter_fault_code", "GB/T 19963"),
    ("pv.arrayType", "组件类型", "RW", "INT", None, "pv", "组件类型(单晶/多晶/薄膜)", "pv_array_type", "IEC 61724"),
    ("pv.moduleCapacity", "单组件额定功率", "RW", "FLOAT", "Wp", "pv", "单块组件额定功率", "pv_module_capacity", "IEC 61724"),
    ("pv.moduleCount", "组件数量", "RW", "INT", None, "pv", "组件数量", "pv_module_count", None),
    ("pv.tiltAngle", "倾角", "RW", "FLOAT", "°", "pv", "组件倾角", "pv_tilt_angle", "IEC 61724"),
    ("pv.azimuth", "方位角", "RW", "FLOAT", "°", "pv", "组件方位角", "pv_azimuth", "IEC 61724"),
    ("pv.stringVoltage", "组串电压", "R", "FLOAT", "V", "pv", "组串电压", "pv_string_voltage", "GB/T 19963"),
    ("pv.stringCurrent", "组串电流", "R", "FLOAT", "A", "pv", "组串电流", "pv_string_current", "GB/T 19963"),
    ("pv.dcPower", "直流侧功率", "R", "FLOAT", "kW", "pv", "直流侧功率", "pv_dc_power", "IEC 61724"),
    ("pv.dcVoltage", "直流电压", "R", "FLOAT", "V", "pv", "直流电压", "pv_dc_voltage", None),
    ("pv.dcCurrent", "直流电流", "R", "FLOAT", "A", "pv", "直流电流", "pv_dc_current", None),
    ("pv.stringStatus", "组串状态", "R", "INT", None, "pv", "组串状态(正常/异常/断开)", "pv_string_status", None),
    ("pv.stringRatio", "组串效率比", "R", "FLOAT", "%", "pv", "组串效率比(PR)", "pv_string_ratio", "IEC 61724"),
    ("pv.inverterRatedPower", "逆变器额定功率", "RW", "FLOAT", "kW", "pv", "逆变器额定功率", "pv_inverter_rated_power", "GB/T 19963"),
    ("pv.efficiency", "转换效率", "R", "FLOAT", "%", "pv", "逆变器转换效率", "pv_inverter_efficiency", "IEC 61724"),
    ("pv.mpptVoltage", "MPPT电压", "R", "FLOAT", "V", "pv", "MPPT电压", "pv_inverter_mppt_voltage", "GB/T 19963"),
    ("pv.inverterTemp", "逆变器内部温度", "R", "FLOAT", "°C", "pv", "逆变器内部温度", "pv_inverter_temp", None),
    ("pv.runningHours", "累计运行时长", "R", "FLOAT", "h", "pv", "逆变器累计运行时长", "pv_inverter_running_hours", None),
    ("pv.monthlyYield", "月发电量", "R", "FLOAT", "kWh", "pv", "光伏月发电量", "pv_total_monthly_yield", "IEC 61724"),
    ("pv.co2Reduction", "CO2减排量", "R", "FLOAT", "kg", "pv", "CO2减排量", "pv_co2_reduction", None),
    ("pv.equivalentHours", "等效利用小时数", "R", "FLOAT", "h", "pv", "等效利用小时数", "pv_equivalent_hours", "GB/T 19963"),
    ("pv.performanceRatio", "系统效率比", "R", "FLOAT", "%", "pv", "系统效率比(PR)", "pv_performance_ratio", "IEC 61724"),
    ("pv.curtailmentPower", "限电功率", "R", "FLOAT", "kW", "pv", "限电功率", "pv_curtailment_power", "GB/T 19963"),
    ("pv.curtailmentEnergy", "限电量", "R", "FLOAT", "kWh", "pv", "限电量", "pv_curtailment_energy", "GB/T 19963"),
    ("pv.availability", "光伏可用率", "R", "FLOAT", "%", "pv", "光伏可用率", "pv_availability", "IEC 61724"),

    # ── 储能 ESS (section 3.1/3.2/3.4) — 原 15 + 新增 ──
    ("ess.activePower", "储能有功功率", "R", "FLOAT", "kW", "ess", "储能有功功率(充电为正/放电为负)", "ess_power", "GB/T 36547"),
    ("ess.reactivePower", "储能无功功率", "R", "FLOAT", "kVar", "ess", "储能无功功率", "pcs_reactive_power", "GB/T 34120"),
    ("ess.soc", "电池SOC", "R", "FLOAT", "%", "ess", "电池荷电状态SOC", "ess_soc", "GB/T 36558"),
    ("ess.soh", "电池SOH", "R", "FLOAT", "%", "ess", "电池健康状态SOH", "ess_soh", "GB/T 36276"),
    ("ess.voltage", "电池总电压", "R", "FLOAT", "V", "ess", "电池堆/簇总电压", "ess_voltage_total", "GB/T 36558"),
    ("ess.current", "电池总电流", "R", "FLOAT", "A", "ess", "电池总电流(充电为正/放电为负)", "ess_current", "GB/T 36558"),
    ("ess.maxCellTemp", "最高单体温度", "R", "FLOAT", "°C", "ess", "电池最高单体温度", "cell_max_temperature", "GB/T 36276"),
    ("ess.minCellTemp", "最低单体温度", "R", "FLOAT", "°C", "ess", "电池最低单体温度", "cell_min_temperature", "GB/T 36276"),
    ("ess.maxCellVoltage", "最高单体电压", "R", "FLOAT", "V", "ess", "电池最高单体电压", "cell_max_voltage", "GB/T 36276"),
    ("ess.minCellVoltage", "最低单体电压", "R", "FLOAT", "V", "ess", "电池最低单体电压", "cell_min_voltage", "GB/T 36276"),
    ("ess.chargeEnergy", "累计充电电量", "R", "FLOAT", "kWh", "ess", "累计充电电量", "ess_total_charge_energy", None),
    ("ess.dischargeEnergy", "累计放电电量", "R", "FLOAT", "kWh", "ess", "累计放电电量", "ess_total_discharge_energy", None),
    ("ess.status", "储能系统状态", "R", "INT", None, "ess", "储能系统运行状态", "ess_status", "GB/T 36547"),
    ("ess.mode", "储能运行模式", "RW", "STRING", None, "ess", "储能运行模式(调度/削峰填谷/需量控制)", "strategy_type", "GB/T 36547"),
    ("ess.faultCode", "储能故障代码", "R", "STRING", None, "ess", "储能故障代码", "ess_bms_alarm", "GB/T 36276"),
    ("ess.nominalCapacity", "额定容量", "RW", "FLOAT", "kWh", "ess", "电池额定容量", "ess_nominal_capacity", "GB/T 36558"),
    ("ess.nominalPower", "额定功率", "RW", "FLOAT", "kW", "ess", "电池额定功率", "ess_nominal_power", "GB/T 36558"),
    ("ess.sopCharge", "可充电功率", "R", "FLOAT", "kW", "ess", "可充电功率", "ess_sop_charge", None),
    ("ess.sopDischarge", "可放电功率", "R", "FLOAT", "kW", "ess", "可放电功率", "ess_sop_discharge", None),
    ("ess.soe", "能量状态", "R", "FLOAT", "kWh", "ess", "能量状态", "ess_soe", "IEC 62933"),
    ("ess.dod", "放电深度", "R", "FLOAT", "%", "ess", "放电深度", "ess_dod", "GB/T 36276"),
    ("ess.bmsAlarm", "BMS告警状态", "R", "INT", None, "ess", "BMS告警状态", "ess_bms_alarm", "GB/T 36276"),
    ("ess.cycleCount", "循环次数", "R", "INT", None, "ess", "电池循环次数", "ess_cycle_count", "GB/T 36276"),
    ("ess.calendarLife", "日历寿命剩余", "R", "INT", None, "ess", "日历寿命剩余(天)", "ess_calendar_life", None),
    ("ess.cellVoltageDiff", "单体压差", "R", "FLOAT", "mV", "ess", "单体压差", "cell_voltage_diff", "GB/T 36276"),
    ("ess.cellTempDiff", "单体温差", "R", "FLOAT", "°C", "ess", "单体温差", "cell_temp_diff", "GB/T 36276"),
    ("ess.cellAvgTemp", "平均温度", "R", "FLOAT", "°C", "ess", "电池平均温度", "cell_avg_temperature", "GB/T 36276"),
    ("ess.cellBalanceStatus", "均衡状态", "R", "INT", None, "ess", "均衡状态", "cell_balance_status", None),
    ("ess.cellResistance", "单体直流内阻", "R", "FLOAT", "mΩ", "ess", "单体直流内阻", "cell_resistance", "GB/T 36276"),
    ("ess.chargeEnergyDaily", "日充电量", "R", "FLOAT", "kWh", "ess", "日充电量", "ess_charge_energy_daily", "GB/T 36548"),
    ("ess.dischargeEnergyDaily", "日放电量", "R", "FLOAT", "kWh", "ess", "日放电量", "ess_discharge_energy_daily", "GB/T 36548"),
    ("ess.roundTripEfficiency", "综合往返效率", "R", "FLOAT", "%", "ess", "综合往返效率", "ess_round_trip_efficiency", "GB/T 36548"),
    ("ess.selfDischargeRate", "自放电率", "R", "FLOAT", "%/月", "ess", "自放电率", "ess_self_discharge_rate", "GB/T 36276"),
    ("ess.availability", "储能可用率", "R", "FLOAT", "%", "ess", "储能可用率", "ess_availability", "GB/T 36558"),
    ("ess.responseTime", "响应时间", "R", "FLOAT", "ms", "ess", "响应时间", "ess_response_time", "GB/T 36547"),

    # ── 储能变流器 PCS (section 3.3) ──
    ("pcs.ratedPower", "PCS额定功率", "RW", "FLOAT", "kW", "pcs", "PCS额定功率", "pcs_rated_power", "GB/T 34120"),
    ("pcs.activePower", "PCS交流侧功率", "R", "FLOAT", "kW", "pcs", "PCS交流侧功率", "pcs_ac_power", "GB/T 34120"),
    ("pcs.voltageA", "PCS A相电压", "R", "FLOAT", "V", "pcs", "PCS A相交流电压", "pcs_ac_voltage_a", "GB/T 34120"),
    ("pcs.voltageB", "PCS B相电压", "R", "FLOAT", "V", "pcs", "PCS B相交流电压", "pcs_ac_voltage_b", "GB/T 34120"),
    ("pcs.voltageC", "PCS C相电压", "R", "FLOAT", "V", "pcs", "PCS C相交流电压", "pcs_ac_voltage_c", "GB/T 34120"),
    ("pcs.currentA", "PCS A相电流", "R", "FLOAT", "A", "pcs", "PCS A相交流电流", "pcs_ac_current_a", "GB/T 34120"),
    ("pcs.currentB", "PCS B相电流", "R", "FLOAT", "A", "pcs", "PCS B相交流电流", "pcs_ac_current_b", "GB/T 34120"),
    ("pcs.currentC", "PCS C相电流", "R", "FLOAT", "A", "pcs", "PCS C相交流电流", "pcs_ac_current_c", "GB/T 34120"),
    ("pcs.dcPower", "PCS直流侧功率", "R", "FLOAT", "kW", "pcs", "PCS直流侧功率", "pcs_dc_power", "GB/T 34120"),
    ("pcs.dcVoltage", "PCS直流侧电压", "R", "FLOAT", "V", "pcs", "PCS直流侧电压", "pcs_dc_voltage", "GB/T 34120"),
    ("pcs.dcCurrent", "PCS直流侧电流", "R", "FLOAT", "A", "pcs", "PCS直流侧电流", "pcs_dc_current", "GB/T 34120"),
    ("pcs.frequency", "PCS频率", "R", "FLOAT", "Hz", "pcs", "PCS频率", "pcs_frequency", "GB/T 34120"),
    ("pcs.powerFactor", "PCS功率因数", "R", "FLOAT", None, "pcs", "PCS功率因数", "pcs_power_factor", "GB/T 34120"),
    ("pcs.efficiency", "PCS转换效率", "R", "FLOAT", "%", "pcs", "PCS转换效率", "pcs_efficiency", "GB/T 34120"),
    ("pcs.reactivePower", "PCS无功功率", "R", "FLOAT", "kVar", "pcs", "PCS无功功率", "pcs_reactive_power", "GB/T 34120"),
    ("pcs.chargePowerLimit", "充电功率限值", "RW", "FLOAT", "kW", "pcs", "充电功率限值", "pcs_charge_power_limit", "GB/T 34120"),
    ("pcs.dischargePowerLimit", "放电功率限值", "RW", "FLOAT", "kW", "pcs", "放电功率限值", "pcs_discharge_power_limit", "GB/T 34120"),
    ("pcs.controlMode", "PCS控制模式", "RW", "INT", None, "pcs", "控制模式(PQ/VF/VSG/下垂)", "pcs_control_mode", "GB/T 34120"),
    ("pcs.status", "PCS状态", "R", "INT", None, "pcs", "PCS状态(运行/待机/停机/故障)", "pcs_status", None),
    ("pcs.faultCode", "PCS故障码", "R", "STRING", None, "pcs", "PCS故障码", "pcs_fault_code", None),
    ("pcs.temp", "PCS内部温度", "R", "FLOAT", "°C", "pcs", "PCS内部温度", "pcs_temp", None),

    # ── 充电桩 Charger/EVSE (section 4) — 原 10 + 新增 ──
    ("charger.connectorStatus", "充电枪连接状态", "R", "INT", None, "charger", "充电枪连接状态", "connector_status", "IEC 61851"),
    ("charger.chargingPower", "充电功率", "R", "FLOAT", "kW", "charger", "充电桩实时充电功率", "charging_power", "GB/T 18487.1"),
    ("charger.chargingCurrent", "充电电流", "R", "FLOAT", "A", "charger", "充电桩实时充电电流", "charging_current", "GB/T 18487.1"),
    ("charger.chargingVoltage", "充电电压", "R", "FLOAT", "V", "charger", "充电桩实时充电电压", "charging_voltage", "GB/T 18487.1"),
    ("charger.soc", "车辆SOC", "R", "FLOAT", "%", "charger", "车辆当前SOC", "charging_soc_current", "GB/T 27930"),
    ("charger.chargedEnergy", "已充电量", "R", "FLOAT", "kWh", "charger", "本次已充电量", "charging_energy", "OCPP"),
    ("charger.connectorTemp", "充电枪温度", "R", "FLOAT", "°C", "charger", "充电枪温度", None, None),
    ("charger.faultCode", "充电桩故障代码", "R", "STRING", None, "charger", "充电桩故障代码", "evse_fault_code", "OCPP"),
    ("charger.startCharging", "启动充电", "W", "BOOL", None, "charger", "启动充电控制指令", None, "IEC 61851"),
    ("charger.stopCharging", "停止充电", "W", "BOOL", None, "charger", "停止充电控制指令", None, "IEC 61851"),
    ("charger.ratedPower", "充电桩额定功率", "RW", "FLOAT", "kW", "charger", "充电桩额定功率", "evse_rated_power", "GB/T 18487.1"),
    ("charger.ratedVoltage", "充电桩额定电压", "RW", "FLOAT", "V", "charger", "充电桩额定电压", "evse_rated_voltage", "GB/T 18487.1"),
    ("charger.ratedCurrent", "充电桩额定电流", "RW", "FLOAT", "A", "charger", "充电桩额定电流", "evse_rated_current", "GB/T 18487.1"),
    ("charger.status", "充电桩状态", "R", "INT", None, "charger", "桩状态(空闲/充电中/故障/离线/维护)", "evse_status", "OCPP"),
    ("charger.onlineStatus", "在线状态", "R", "INT", None, "charger", "在线状态(在线/离线)", "evse_online_status", None),
    ("charger.gunStatus", "充电枪状态", "R", "INT", None, "charger", "枪状态(已插枪/未插枪/锁定)", "gun_status", "OCPP"),
    ("charger.chargingDuration", "充电时长", "R", "FLOAT", "min", "charger", "充电时长", "charging_duration", "OCPP"),
    ("charger.socStart", "起始SOC", "R", "FLOAT", "%", "charger", "起始SOC", "charging_soc_start", "GB/T 27930"),
    ("charger.socEnd", "结束SOC", "R", "FLOAT", "%", "charger", "结束SOC", "charging_soc_end", "GB/T 27930"),
    ("charger.chargingMode", "充电模式", "R", "INT", None, "charger", "充电模式(恒流/恒压/恒功率)", "charging_mode", "GB/T 27930"),
    ("charger.bmsVoltage", "BMS需求电压", "R", "FLOAT", "V", "charger", "BMS需求电压", "bms_voltage", "GB/T 27930"),
    ("charger.bmsCurrent", "BMS需求电流", "R", "FLOAT", "A", "charger", "BMS需求电流", "bms_current", "GB/T 27930"),
    ("charger.bmsBatteryTemp", "电池温度", "R", "FLOAT", "°C", "charger", "车辆电池温度", "bms_battery_temp", "GB/T 27930"),
    ("charger.bmsInsulationResistance", "绝缘电阻", "R", "FLOAT", "MΩ", "charger", "绝缘电阻", "bms_insulation_resistance", "GB/T 27930"),
    ("charger.bmsFaultCode", "BMS故障码", "R", "STRING", None, "charger", "BMS故障码", "bms_fault_code", "GB/T 27930"),
    ("charger.stationTotalPower", "充电总功率", "R", "FLOAT", "kW", "charger", "充电总功率", "station_total_power_evse", None),
    ("charger.stationDailyEnergy", "日充电量", "R", "FLOAT", "kWh", "charger", "站级日充电量", "station_daily_energy_evse", None),
    ("charger.stationTotalEnergy", "累计充电量", "R", "FLOAT", "kWh", "charger", "站级累计充电量", "station_total_energy_evse", None),
    ("charger.dailyOrders", "日充电订单数", "R", "INT", None, "charger", "日充电订单数", "station_daily_orders", None),
    ("charger.occupiedRate", "充电桩占用率", "R", "FLOAT", "%", "charger", "充电桩占用率", "station_occupied_rate", None),
    ("charger.avgChargeDuration", "平均充电时长", "R", "FLOAT", "min", "charger", "平均充电时长", "station_avg_charge_duration", None),
    ("charger.peakPower", "充电峰值功率", "R", "FLOAT", "kW", "charger", "充电峰值功率", "station_peak_power_evse", None),

    # ── 电网侧 Grid (section 5) ──
    ("grid.voltageA", "电网A相电压", "R", "FLOAT", "V", "grid", "电网A相电压", "grid_voltage_a", "GB/T 19963"),
    ("grid.voltageB", "电网B相电压", "R", "FLOAT", "V", "grid", "电网B相电压", "grid_voltage_b", "GB/T 19963"),
    ("grid.voltageC", "电网C相电压", "R", "FLOAT", "V", "grid", "电网C相电压", "grid_voltage_c", "GB/T 19963"),
    ("grid.currentA", "电网A相电流", "R", "FLOAT", "A", "grid", "电网A相电流", "grid_current_a", "GB/T 19963"),
    ("grid.currentB", "电网B相电流", "R", "FLOAT", "A", "grid", "电网B相电流", "grid_current_b", "GB/T 19963"),
    ("grid.currentC", "电网C相电流", "R", "FLOAT", "A", "grid", "电网C相电流", "grid_current_c", "GB/T 19963"),
    ("grid.activePower", "关口有功功率", "R", "FLOAT", "kW", "grid", "关口有功功率(正向购电/负向售电)", "grid_power_active", "GB/T 19963"),
    ("grid.reactivePower", "关口无功功率", "R", "FLOAT", "kVar", "grid", "关口无功功率", "grid_power_reactive", "GB/T 19963"),
    ("grid.apparentPower", "视在功率", "R", "FLOAT", "kVA", "grid", "视在功率", "grid_power_apparent", "GB/T 19963"),
    ("grid.frequency", "电网频率", "R", "FLOAT", "Hz", "grid", "电网频率", "grid_frequency", "GB/T 19963"),
    ("grid.powerFactor", "关口功率因数", "R", "FLOAT", None, "grid", "关口功率因数", "grid_power_factor", "GB/T 19963"),
    ("grid.voltageThd", "电压谐波畸变率", "R", "FLOAT", "%", "grid", "电压总谐波畸变率", "grid_voltage_thd", "IEEE 1547"),
    ("grid.currentThd", "电流谐波畸变率", "R", "FLOAT", "%", "grid", "电流总谐波畸变率", "grid_current_thd", "IEEE 1547"),
    ("grid.importEnergy", "购电量", "R", "FLOAT", "kWh", "grid", "购电量(从电网取电)", "grid_import_energy", "GB/T 19963"),
    ("grid.exportEnergy", "售电量", "R", "FLOAT", "kWh", "grid", "售电量(向电网送电)", "grid_export_energy", "GB/T 19963"),
    ("grid.dailyImport", "日购电量", "R", "FLOAT", "kWh", "grid", "日购电量", "grid_daily_import", None),
    ("grid.dailyExport", "日售电量", "R", "FLOAT", "kWh", "grid", "日售电量", "grid_daily_export", None),
    ("grid.demandActive", "最大需量", "R", "FLOAT", "kW", "grid", "最大需量", "grid_demand_active", None),
    ("grid.peakPower", "尖峰功率", "R", "FLOAT", "kW", "grid", "尖峰功率", "grid_peak_power", None),

    # ── 环境与气象 Env (section 6) ──
    ("env.irradiancePoa", "倾斜面辐照度", "R", "FLOAT", "W/m²", "env", "倾斜面辐照度", "irradiance_poa", "IEC 61724"),
    ("env.irradianceGhi", "水平总辐照度", "R", "FLOAT", "W/m²", "env", "水平总辐照度", "irradiance_ghi", "IEC 61724"),
    ("env.irradianceDni", "直接法向辐照度", "R", "FLOAT", "W/m²", "env", "直接法向辐照度", "irradiance_dni", "IEC 61724"),
    ("env.windSpeed", "风速", "R", "FLOAT", "m/s", "env", "风速", "wind_speed", "IEC 61724"),
    ("env.windDirection", "风向", "R", "FLOAT", "°", "env", "风向", "wind_direction", "IEC 61724"),
    ("env.humidity", "相对湿度", "R", "FLOAT", "%", "env", "相对湿度", "humidity", None),
    ("env.pressure", "大气压力", "R", "FLOAT", "hPa", "env", "大气压力", "atmospheric_pressure", None),
    ("env.rainfall", "降雨量", "R", "FLOAT", "mm", "env", "降雨量", "rainfall", None),
    ("env.snowDepth", "积雪深度", "R", "FLOAT", "cm", "env", "积雪深度", "snow_depth", None),
    ("env.pm25", "PM2.5浓度", "R", "FLOAT", "μg/m³", "env", "PM2.5浓度", "pm25", None),

    # ── 能量管理与调度 EMS (section 7) ──
    ("ems.loadPowerTotal", "负载总有功功率", "R", "FLOAT", "kW", "ems", "负载总有功功率", "load_power_total", None),
    ("ems.loadEnergyDaily", "负载日用电量", "R", "FLOAT", "kWh", "ems", "负载日用电量", "load_energy_daily", None),
    ("ems.pvSelfConsumptionRate", "光伏自发自用率", "R", "FLOAT", "%", "ems", "光伏自发自用率", "pv_self_consumption_rate", None),
    ("ems.pvSelfSufficiencyRate", "光伏自给率", "R", "FLOAT", "%", "ems", "光伏自给率", "pv_self_sufficiency_rate", None),
    ("ems.energyFlowDirection", "能量流向", "R", "INT", None, "ems", "能量流向", "energy_flow_direction", None),
    ("ems.essDispatchPower", "储能调度设定功率", "RW", "FLOAT", "kW", "ems", "储能调度设定功率", "ess_dispatch_power", "GB/T 36547"),
    ("ems.selfBalanceRate", "站级自平衡率", "R", "FLOAT", "%", "ems", "站级自平衡率", "station_self_balance_rate", None),
    ("ems.reversePowerPrevention", "防逆流控制", "RW", "INT", None, "ems", "防逆流控制标志", "reverse_power_prevention", "GB/T 19963"),
    ("ems.reversePowerLimit", "逆流功率限值", "RW", "FLOAT", "kW", "ems", "逆流功率限值", "reverse_power_limit", None),
    ("ems.demandForecast", "下一小时负荷预测", "R", "FLOAT", "kW", "ems", "下一小时负荷预测", "demand_forecast_next_hour", "IEC 61970"),
    ("ems.strategyType", "策略类型", "RW", "INT", None, "ems", "策略类型(削峰填谷/需量管理/自发自用/防逆流/虚拟电厂调度)", "strategy_type", "GB/T 36547"),
    ("ems.strategyStatus", "策略生效状态", "RW", "INT", None, "ems", "策略生效状态", "strategy_status", None),
    ("ems.strategyPriority", "策略优先级", "RW", "INT", None, "ems", "策略优先级", "strategy_priority", None),
    ("ems.strategyPowerLimit", "最大允许功率", "RW", "FLOAT", "kW", "ems", "最大允许功率", "strategy_power_limit", None),
    ("ems.strategySocMin", "SOC下限阈值", "RW", "FLOAT", "%", "ems", "SOC下限阈值", "strategy_soc_min", "GB/T 36547"),
    ("ems.strategySocMax", "SOC上限阈值", "RW", "FLOAT", "%", "ems", "SOC上限阈值", "strategy_soc_max", "GB/T 36547"),
    ("ems.strategyRegulationMode", "调节模式", "RW", "INT", None, "ems", "调节模式(AVC/AGC本地/远方)", "strategy_regulation_mode", "GB/T 36547"),
    ("ems.strategySchedulePower", "调度下发有功功率", "RW", "FLOAT", "kW", "ems", "调度下发有功功率", "strategy_schedule_power", "IEC 61850"),
    ("ems.strategyScheduleReactive", "调度下发无功功率", "RW", "FLOAT", "kVar", "ems", "调度下发无功功率", "strategy_schedule_reactive", "IEC 61850"),

    # ── 安全与保护 Protection (section 9.2) ──
    ("protection.relayStatus", "保护继电器状态", "R", "INT", None, "protection", "保护继电器状态", "protection_relay_status", "IEEE 1547"),
    ("protection.emergencyStop", "急停按钮状态", "R", "INT", None, "protection", "急停按钮状态", "emergency_stop_status", None),
    ("protection.arcFault", "电弧故障检测", "R", "INT", None, "protection", "电弧故障检测标志", "arc_fault_detected", None),
    ("protection.insulationResistancePv", "光伏对地绝缘电阻", "R", "FLOAT", "MΩ", "protection", "光伏对地绝缘电阻", "insulation_resistance_pv", "GB/T 19963"),
    ("protection.insulationResistanceEss", "储能对地绝缘电阻", "R", "FLOAT", "MΩ", "protection", "储能对地绝缘电阻", "insulation_resistance_ess", "GB/T 36558"),
    ("protection.antiIslanding", "防孤岛保护状态", "R", "INT", None, "protection", "防孤岛保护状态", "anti_islanding_status", "IEEE 1547"),
    ("protection.overVoltageTrip", "过压脱扣次数", "R", "INT", None, "protection", "过压脱扣次数", "over_voltage_trip", None),
    ("protection.underVoltageTrip", "欠压脱扣次数", "R", "INT", None, "protection", "欠压脱扣次数", "under_voltage_trip", None),
    ("protection.overFrequencyTrip", "过频脱扣次数", "R", "INT", None, "protection", "过频脱扣次数", "over_frequency_trip", None),
    ("protection.underFrequencyTrip", "低频脱扣次数", "R", "INT", None, "protection", "低频脱扣次数", "under_frequency_trip", None),
    ("protection.fireAlarm", "消防告警状态", "R", "INT", None, "protection", "消防告警状态", "fire_alarm_status", "GB/T 51048"),
    ("protection.smokeDetector", "烟感状态", "R", "INT", None, "protection", "烟感状态", "smoke_detector", None),
    ("protection.cabinetTemp", "柜体温度", "R", "FLOAT", "°C", "protection", "柜体温度", "temperature_humidity_cabinet", None),
    ("protection.cabinetHumidity", "柜体湿度", "R", "FLOAT", "%", "protection", "柜体湿度", "temperature_humidity_cabinet", None),

    # ── 交易与计费 Billing (section 11.1) ──
    ("billing.tariffSharpPrice", "尖峰电价", "RW", "FLOAT", "元/kWh", "billing", "尖峰电价", "tariff_sharp_price", None),
    ("billing.tariffPeakPrice", "峰时段电价", "RW", "FLOAT", "元/kWh", "billing", "峰时段电价", "tariff_peak_price", None),
    ("billing.tariffFlatPrice", "平时段电价", "RW", "FLOAT", "元/kWh", "billing", "平时段电价", "tariff_flat_price", None),
    ("billing.tariffValleyPrice", "谷时段电价", "RW", "FLOAT", "元/kWh", "billing", "谷时段电价", "tariff_valley_price", None),
    ("billing.tariffDemandPrice", "需量电价", "RW", "FLOAT", "元/kW·月", "billing", "需量电价", "tariff_demand_price", None),
    ("billing.electricityCost", "电费", "R", "FLOAT", "元", "billing", "电费", "electricity_cost", None),
    ("billing.savingsByEss", "储能节省电费", "R", "FLOAT", "元", "billing", "储能节省电费", "savings_by_ess", None),
    ("billing.revenueByPv", "光伏卖电收益", "R", "FLOAT", "元", "billing", "光伏卖电收益", "revenue_by_pv", None),
    ("billing.evseServiceFee", "充电服务费", "RW", "FLOAT", "元/kWh", "billing", "充电服务费", "evse_service_fee", None),
    ("billing.marketRevenue", "市场收益", "R", "FLOAT", "元", "billing", "市场收益", "market_revenue", "IEC 62325"),
]


def seed_standard_entities() -> dict:
    """幂等播种标准实体目录（启动时调用，单一数据源）。"""
    from loguru import logger
    from app.services.telemetry_store import get_connection

    ensure_sql = (
        "ALTER TABLE t_entities ADD COLUMN IF NOT EXISTS std_field TEXT; "
        "ALTER TABLE t_entities ADD COLUMN IF NOT EXISTS std_ref TEXT;"
    )
    upsert_sql = """
        INSERT INTO t_entities
          (name, display_name, entity_type, data_type, unit, category,
           description, enabled, is_system, std_field, std_ref)
        VALUES (%s,%s,%s,%s,%s,%s,%s,TRUE,TRUE,%s,%s)
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          std_field   = EXCLUDED.std_field,
          std_ref     = EXCLUDED.std_ref,
          is_system   = TRUE,
          updated_at  = now()
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(ensure_sql)
                cur.executemany(upsert_sql, [tuple(r) for r in STANDARD_ENTITIES])
                conn.commit()
        logger.info("[StandardEntities] seeded {} entities", len(STANDARD_ENTITIES))
        return {"seeded": len(STANDARD_ENTITIES), "ok": True}
    except Exception as e:
        logger.error("[StandardEntities] seed failed: {}", e)
        return {"seeded": 0, "ok": False, "error": str(e)}
