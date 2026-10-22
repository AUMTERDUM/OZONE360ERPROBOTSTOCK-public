const s3 = require('sqlite3').verbose();
const db = new s3.Database('dev.db');
db.all('SELECT COUNT(*) as cnt FROM SparePart', (e, r) => {
  console.log('Total SpareParts:', r[0].cnt);
  db.all("SELECT category, COUNT(*) as cnt FROM SparePart WHERE supplier='PUDU' GROUP BY category ORDER BY cnt DESC LIMIT 20", (e2, r2) => {
    console.log('\nParts by model:');
    r2.forEach(x => console.log('  ' + (x.category || '(none)') + ': ' + x.cnt));
    db.all("SELECT sku, name, category, unitPrice FROM SparePart WHERE supplier='PUDU' ORDER BY RANDOM() LIMIT 5", (e3, r3) => {
      console.log('\nSample:');
      r3.forEach(x => console.log('  [' + x.sku + '] ' + x.name.substring(0, 60) + ' | ' + (x.category || '') + ' | $' + x.unitPrice));
      db.close();
    });
  });
});
