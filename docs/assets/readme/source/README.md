# hero GIF 再生成方法（source/）

- `hero-motion.json` — 动效规格（beautify-github-readme render_motion_gif 工作流：图层/揭示窗口、30fps、5.6s、192 色、纯色键透明）。
- `render_motion_gif.py` — skill 自带脚本的副本，唯一改动 `palettegen stats_mode=diff→full`（diff 模式只统计帧间变化像素，圆角透明键色 #ff00ff 恒不被调色板收录 → mark_key_color_transparent 必失败；full 模式纳全量像素）。
- `rsvg_shim.py` + `rsvg-convert.bat` — Windows 无 rsvg-convert/sips 的替身：Edge 无头截图（`--default-background-color=00000000` 保透明度）逐层栅格化。
- ffmpeg：`pip install imageio-ffmpeg`，把其二进制复制为 `ffmpeg.exe` 放进本目录（或 PATH 可达处；**勿提交二进制**，约 25MB）。

运行（仓库根）：

```powershell
$env:PATH = "docs\assets\readme\source;$env:PATH"
python docs\assets\readme\source\render_motion_gif.py docs\assets\readme\hero.svg docs\assets\readme\hero.gif --spec docs\assets\readme\source\hero-motion.json
python docs\assets\readme\source\render_motion_gif.py docs\assets\readme\hero-en.svg docs\assets\readme\hero-en.gif --spec docs\assets\readme\source\hero-motion.json
```

hero.svg / hero-en.svg 是可编辑源与静态兜底（GitHub 不播放 SVG 内动画，README 嵌入 GIF）。
