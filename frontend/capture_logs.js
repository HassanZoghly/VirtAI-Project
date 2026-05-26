import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  console.log("Navigating to http://localhost:5173/");
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  
  console.log("Waiting 3 seconds...");
  await new Promise(r => setTimeout(r, 3000));
  
  await browser.close();
})();
