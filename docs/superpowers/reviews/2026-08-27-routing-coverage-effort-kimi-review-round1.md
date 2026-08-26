# kimi-tide 0.8.0 设计稿独立评审报告（Round 1，Kimi k3）

> 评审人：Kimi k3（@kimi 只读子代理，2026-08-27 凌晨）。对照 config.ts / settings-schema.ts / rules.ts / router.ts / transcribe.ts / index.ts / projection.ts / types.ts / SettingsCard.tsx / card-store.ts / dsh-llm 类型与运行时实测。
> 评审对象：`docs/superpowers/specs/2026-08-27-routing-coverage-effort-design.md`（commit `8233c2f`）。

## 严重（硬伤）

无致命硬伤。三条决策线的主体机制均可在现行源码上落地。但有 1 条接近严重、按上限列入：

**S1. D3「档位目录通道优先复用 kimi-tide/panel 投影 candidates」结构性不可行，且现行代码已自带反证。**
- 位置：设计 §D3「优先复用 kimi-tide/panel 投影 candidates 扩展」。
- 证据：①card-store.ts:44 注释明确「settings.section 是 root 作用域 slot、拿不到 session 级投影」——设置卡片根本没有会话上下文，而 panel 投影是按 agent 追加进各会话日志的（index.ts:497-537 pushPanel(agent)），设置页读不到任何会话的投影。②即便能读，types.ts:16 CandidateSummary 只有 {provider, model, available}，无 reasoningEfforts；③projection.ts:55-59 的 zod schema 固定三字段（zod 默认剥离未知键），扩展必须改 schema + 按本仓惯例（projection.ts:94-96 注释「形状变更即弃旧缓存」）递升 stateVersion 7，作废全部持久化投影缓存——设计完全未提这个代价。④卡片现行的宿主目录通道 connection.api.llm.models（card-store.ts:90-95 ConnectionLike）每个模型只回传 {id}，扩它要改宿主 dsh-host-apiproxy，超出本插件包边界。
- 建议：把「优先复用 panel 投影」直接划掉。可行替代：插件 Host 侧已通过 resolveModelInfo 枚举出 reasoningEfforts（index.ts:173-175），新增一条插件自有 Host→Client JSON 通道（或借 settings 命名空间旁边的只读描述通道）把 per-model 档位表送进卡片；spike 应钉死这条，而不是钉死一条已证伪的缝。设计虽有「若该缝不适配再另选」的兜底措辞，但首选方向已在源码层面被证伪，应改写。

## 中等（落地方案需修正）

**M1. D1 背景事实错误：内置没有 plan 组。** 设计 §1 称「现只有 3 个关键词组（code 17 / chitchat 8 / plan 4）」，但 config.ts:88-91 DEFAULT_KEYWORD_GROUPS 只有 code + chitchat 两组；plan 仅存在于 rules.test.ts:70-84 的测试夹具。这影响 D1 排序自洽性论证的覆盖面——若用户实机配置里有自建 plan 组，新组接入后的平手序分析并未涵盖它。建议：修正背景表述，并在验收 B2 类交叉探针中补一条 plan（若用户实机确有此组）。

**M2. 验收 B2 的探针例在现行排序语义下是平手局，措辞与实际结果不一致。** 「帮我审查这段代码」：review 组命中 1 词（审查，中文子串），code 组命中 1 词（代码）→ 特异度平手 → 按列表序由 code 先胜（设计自定的 capability 序 image→code→review→…，rules.ts:108 稳定排序）。即该句实机落 kimi-for-coding 而非 review 目标 k3。B2 写「双中取词数多者」——词数相等时此描述不决定结果。若用户意图是「审查类优先」，则规则序应为 review 在 code 前（与现行 config.ts:109-110 注释「code 提到 chitchat 前防劫持」同理的序级决策）；若意图就是 code 先，B2 应写明预期落 code。两者必改其一，否则验收无可判定的预期值。

**M3. 「试一句」测试器与决策 chip 升级都不能按设计所说的「复用 matchingRules + decide 纯函数面」原样实现——matchingRules 不返回命中数。** rules.ts:86 matchingRules 返回 RouterRule[]，score 在内部 hits 数组里被丢弃（:109 hits.map(h => h.rule)）。「含命中词数与特异度比较」的测试器输出、buildDecisionSummary 的「命中 2 词」原因，都需要 score。改返回类型会破坏 router.ts:226 的 for-of 消费与全部 0.7.0 测试断言。建议：新增导出纯函数（如 matchingScored 返回 {rule, score}[]，matchingRules 改为其薄封装保旧契约），decide 消费新函数组装原因。另注意：测试器要显示「最终路由目标」需可用性过滤（router.ts:241-243 按 metas.available 跳过），而卡片 availability 只覆盖已配置目标（card-store.ts:221-232）——规则目标恰在覆盖集内，可用；但图像护栏/flow 降级路径在浏览器侧无法复刻（无 modalities），测试器结果与实机在带图场景会分叉，B4 验收须限定文本探针或声明此偏差。

**M4. effort id 空间校验口径与宿主事实不符。** 设计 §D3「id 空间 = minimal/low/medium/high/max」并要 validateRouterConfig 校验。但 dsh-llm 的 ReasoningEffortId 是开放 branded string（brand.d.ts:41/47 `ReasoningEffortId(id: string)`），本仓 router.ts:144 REASONING_LEVELS 已含 off 与 xhigh。固定五档白名单会拒掉合法档位（如某模型声明 xhigh），且 validateRouterConfig 是同步纯函数、拿不到 per-model resolveModelInfo，「目标模型是否支持该档」在写期本就无法校验——设计把两层校验混在一起。建议：validateRouterConfig 只做形状校验（string 非空），id 合法性交给运行期降级条款（设计已有的第二保险），或白名单对齐 REASONING_LEVELS 并注释其为「已知档位软名单」。第二保险本身必要且动机正确——dsh-llm index.js:582-589 对不支持的显式 effort 直接抛 UNSUPPORTED_REASONING_EFFORT，无钳制。

**M5. rule effort 与会话继承 effort 的优先级设计缺失。** router.ts:260-272 replaceRoute 现行语义：会话继承 reasoningEffort → reasoningEffortFor 钳制/剥离。设计只说「规则目标加 effort」与「不支持降级为不指定」，未规定 target.effort 与 inherited 的优先关系。按动机（用户要按规则指定）应是 target.effort 覆盖 inherited 后再过支持集判定，但需写明；且图像护栏二次 replaceRoute（router.ts:633-635）会把规则 effort 当 inherited 带给改道后的视觉模型（如 code 规则 effort=max 被护栏改道到 k3 → k3 也吃 max），是否合意需裁定。

**M6. VisionCaller 注入 effort 的降级判定缺数据通路。** transcribe.ts:17-22 VisionCaller(target, prompt, images, signal)——target 是 RouteTarget，effort 随类型自动带上，签名可不动；createStreamVisionCaller（router.ts:346）Ruling 2 注释「不携带 reasoningEffort」将被推翻，GenerateOptions.reasoningEffort 字段存在（dsh-llm types.d.ts:337），字段名与设计一致。但「目标不支持则降级不指定」需要该视觉模型的 reasoningEfforts 能力表，而 createStreamVisionCaller 只有 ctx、接触不到 CandidateMeta[] 池。实施需把能力查询（metas 或一个 resolver）注入工厂——设计涉及文件清单未点出这个依赖注入点。

**M7. effort 落在 RouteTarget 上会无差别波及 ReviewFlow.reviewer。** targetSchema 被 transcribe.visionModel / review.reviewer / preset.default / 规则 target 四处共用（settings-schema.ts:8,21,31,37），加 effort 后 reviewer 也能配 effort，但设计生效点清单不含 review 执行层——schema 接受、运行不生效的哑巴字段。建议：要么设计声明 reviewer 也生效并列入涉及文件，要么 flowSchema 内联一份无 effort 的 target schema。

## 轻微

- L1. D1 五组词表与既有组无实质交叉误伤：review 的 'review'/'audit' 为纯 ASCII 走词边界守卫（rules.ts:74-75），"preview"/"code-review" 前者被阻断、后者各中 1 词平手归 code（合理）；五组内部及与 code/chitchat 无共享词。审查组「意见」偏宽（「给我点意见」类闲聊会命中 review 组），属数据调优范畴，建议验收后观察。
- L2. 决策 chip 原因升级：DecisionSummary.reason 是自由串 ≤120 截断（index.ts:93、projection.ts:62 schema 只限长度），投影/面板契约不破坏；破坏面集中在断言精确原因串的单测（rules/router/index 测试），设计涉及文件清单已涵盖，属预期工作量。
- L3. minHits 已有 aria-label「最少命中词数」（SettingsCard.tsx:535），D2 诉求是加可见 label + 小字提示——纯 UI 增量，注意 hooks 纪律注释（:331-333）下新增 useState 必须置顶。
- L4. schema 兼容论证成立：settings-schema.ts:45-48 注释实证 schemastery 非 strict 透传未知键，effort 即使不入 schema 也能存活往返；显式入 schema（不带 default，沿用 imageFallback 先例 :58-59）无 version bump 合法。isFlowTarget（'flow' in t）与 configKey（provider/model，不含 effort）均不受 effort 字段影响——但注意 configKey 做可用性去重键时同模型不同 effort 的两条规则共享灰态，无误导。
- L5. 规则区标题改写（SettingsCard.tsx:505「有序，首条命中生效」→ 新语义文案）直接命中 0.7.0 已变的语义，正确且必要；DOM 测试里对该串的断言需同步。
- L6. chitchat 瘦身（迁出翻译/总结）只影响新装与「重置为默认」路径（DEFAULT_CONFIG_V4 是预设唯一种子），存量 keywordGroups 不写回——§4 表述与 mergeResolved/deepMerge 机制（settings-schema.ts:146-159）一致，无迁移留档承诺成立。
- L7. B5 验收的 header 断言路径存在：LlmCallConfig.reasoningEffort（call-config.d.ts:19）即 request/header 落点，与现行 replaceRoute 写路径一致。
- L8. 建议 D2 测试器文案与 decide 一样标注「按当前激活预设」，避免用户在非激活预设下试句产生误解。

## 结论

**落地性：需修改后实施。** 无颠覆性硬伤，但 S1（档位目录通道首选方案已被现行源码证伪，须改写为 spike 钉死插件自有通道）与 M2（B2 验收预期在平手序下无判定值）必须在进入 writing-plans 前修掉；M3–M6 是实施期修正项，写计划时钉死即可。

**成熟度：可用级偏实验级。** D1（数据派补组）与 D2 的静态说明/行级摘要部分是成熟增量，语义不变量与兼容论证与源码逐条吻合；D3 的 effort 链路动机正确（dsh-llm 无钳制、抛错实证）、字段落点真实，但 UI 数据通道与校验口径两处建立在未核实的假设上，拉低整体成熟度。修订 S1/M1/M2 后可按 0.8.0 minor 推进。
