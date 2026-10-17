# Translate and Analyze

讀 PDF / TXT 論文的小工具：選字翻譯、畫線、逐段分析（附原文引用），翻譯和分析在同一個畫面。AI 使用你自己的 ChatGPT 方案（Plus / Pro），不需要 API key。

> 開發中（M0：專案骨架）。

## 安裝（Windows）

1. 到 [Releases](https://github.com/teddylu0219/translate-and-analyze/releases/latest) 下載 `TranslateAnalyze-Setup-x.y.z.exe`。
2. 雙擊安裝。如果出現「Windows 已保護您的電腦」，按 **其他資訊** → **仍要執行**（程式沒有購買程式碼簽章，所以會有這個提示）。
3. 裝好後會自動開啟，桌面也會有捷徑。之後有新版本會自動更新。

## 開發

需要 Node.js 24 以上。

```bash
npm install
npm run dev
```

- `npm run dist`：在本機產生安裝檔到 `dist/`
- 發新版：改 `package.json` 的 `version`，推一個 `v` 開頭的 tag（例如 `v0.1.0`），GitHub Actions 會自動建置並發到 Releases。

## 授權

MIT
