const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, 'lighthouse-report.json');
if (!fs.existsSync(reportPath)) {
  console.error('Report not found');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

console.log('--- CATEGORY SCORES ---');
for (const [key, cat] of Object.entries(data.categories)) {
  console.log(`${cat.title}: ${Math.round(cat.score * 100)}`);
}

console.log('\n--- FAILED AUDITS ---');
for (const [key, audit] of Object.entries(data.audits)) {
  // We care about audits that failed (score < 1, or score === 0 depending on type)
  // Exclude passed audits, notApplicable, or purely informative
  if (audit.score !== null && audit.score < 0.9 && audit.scoreDisplayMode !== 'notApplicable' && audit.scoreDisplayMode !== 'informative') {
    console.log(`- [${audit.score}] ${audit.title} (${key})`);
    if (audit.details && audit.details.items && audit.details.items.length > 0) {
      // Print first 2 items to give context
      audit.details.items.slice(0, 2).forEach(item => {
        let detailsStr = '';
        if (item.node) detailsStr += `Node: ${item.node.snippet} `;
        if (item.url) detailsStr += `URL: ${item.url} `;
        console.log(`    * ${detailsStr}`);
      });
    }
  }
}
