# Google Sheets バックアップ設定手順

## 1. Google Sheets を作成

新しいスプレッドシートを作成し、シート名を「Backup」にする。

## 2. Apps Script を設定

スプレッドシートを開き、メニューから「拡張機能 → Apps Script」を選択。
以下のコードを貼り付けて保存する。

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ユーザーごとのシートを取得または作成
    let sheet = ss.getSheetByName(data.user);
    if (!sheet) {
      sheet = ss.insertSheet(data.user);
      sheet.appendRow(["timestamp", "unit", "question", "attempts", "correct", "accuracy"]);
    }

    // 既存データをクリアして最新を書き込み
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clear();
    }

    let row = 2;
    for (const unitId in data.data) {
      for (const key in data.data[unitId]) {
        const record = data.data[unitId][key];
        const accuracy = record.attempts > 0
          ? Math.round((record.correct / record.attempts) * 100) + "%"
          : "---";
        sheet.getRange(row, 1, 1, 6).setValues([[
          data.timestamp,
          unitId,
          key,
          record.attempts,
          record.correct,
          accuracy
        ]]);
        row++;
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: "ok" })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 3. ウェブアプリとしてデプロイ

1. 「デプロイ → 新しいデプロイ」
2. 種類: 「ウェブアプリ」
3. 実行するユーザー: 「自分」
4. アクセスできるユーザー: 「全員」
5. デプロイして URL をコピー

## 4. アプリに URL を設定

ブラウザのコンソールで以下を実行:

```javascript
localStorage.setItem("sheets-api-url", "ここにデプロイURLを貼る");
```

または、app.js の `SHEETS_API_URL` を直接書き換える。

## データ構造

スプレッドシートには各ユーザーのシートが作られ、以下の列で記録される:

| timestamp | unit | question | attempts | correct | accuracy |
|-----------|------|----------|----------|---------|----------|
| 2026-03-07T... | 630-01 | 5-0 | 3 | 2 | 67% |
| 2026-03-07T... | 630-01 | 5-1 | 2 | 2 | 100% |
