# OmniThings 界面风格规范

> 版本: v1.0 (2026-07-18 用户确认)
> 适用: OmniThings 全部前端页面 (React/Vite + Tailwind; Reflex 项目同样适用)

## 主题
- 仅亮色主题 (light mode)，禁止深色背景
- 背景: `#f0f2f5`
- 主色: `#52c41a` (科技绿)
- 暗色主色: `#389e0d`
- 字体: Inter，基准 13px，数值用 font-mono

## 拟物化 (Neumorphism)

```css
/* 凸起卡片 NEU_CARD */
.neu-card {
  background: #f0f2f5;
  border-radius: 16px;
  box-shadow: 6px 6px 12px #d1d9e6, -6px -6px 12px #ffffff;
  border: 1px solid rgba(255,255,255,0.4);
}

/* 凹陷区域 NEU_INSET */
.neu-inset {
  background: #f0f2f5;
  border-radius: 12px;
  box-shadow: inset 4px 4px 8px #d1d9e6, inset -4px -4px 8px #ffffff;
  border: 1px solid rgba(255,255,255,0.2);
}
```

- 禁止: 深色主题、非 #52c41a 系主色、破坏拟物化一致性的渐变阴影

## 字体层级
- 页面标题: 20px font-bold
- 区域标题: 15px font-bold
- 正文: 12.5px text-gray-600
- 标签: 11px font-black uppercase tracking-widest text-gray-400
- 数值: font-mono

## 布局
- 主内容区最大宽度 1600px 居中，p-8
- 侧边栏展开 w-64 / 折叠 w-20
- 卡片间距 gap-5 或 mb-5
- 响应式断点: ≥1200px 桌面 / 768-1199px 平板 / <768px 手机

## 图标
- Lucide 图标，尺寸 14-20px
- 激活态: `text-[#52c41a]`
- 非激活: `text-gray-500`

## 状态色系
| 语义 | 背景 | 文字 |
|------|------|------|
| 成功/激活 | #52c41a | #389e0d |
| 警告 | yellow-100 | yellow-700 |
| 危险 | red-100 | red-700 |
| 信息 | blue-100 | blue-700 |
| 紫色(阈值告警) | purple-100 | purple-700 |
| 青色(孪生同步) | teal-100 | teal-700 |

## 圆角
- 卡片: 16px (rounded-[16px])
- 凹陷区域: 12px (rounded-[12px])
- Badge/Pill: full (rounded-full)
- 图标容器: 10-14px

## 国际化
- 所有 UI 文本通过 `AppState.t[key]` 获取
- 支持中英文双语切换
