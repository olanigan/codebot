const { chromium } = require('playwright');

async function takeScreenshot() {
  console.log('Connecting to browser via CDP on port 9222...');
  
  // Connect to the existing browser via CDP
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  console.log('Connected to browser');
  
  // Get existing contexts or create a new one
  const contexts = browser.contexts();
  let context;
  
  if (contexts.length > 0) {
    context = contexts[0];
    console.log('Using existing browser context');
  } else {
    context = await browser.newContext();
    console.log('Created new browser context');
  }
  
  // Create a new page
  const page = await context.newPage();
  console.log('Created new page');
  
  // Navigate to example.com
  console.log('Navigating to https://example.com...');
  await page.goto('https://example.com', { waitUntil: 'networkidle' });
  console.log('Page loaded');
  
  // Take screenshot
  const screenshotPath = '/job/workspace/screenshots/test.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);
  
  // Close the page but not the browser (since it's shared)
  await page.close();
  console.log('Done!');
}

takeScreenshot().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
