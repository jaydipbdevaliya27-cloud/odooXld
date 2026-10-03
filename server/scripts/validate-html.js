/**
 * @file server/scripts/validate-html.js
 * @description Validates client/index.html for broken links, asset integrity, and required elements.
 */

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

const htmlPath = path.join(__dirname, '..', '..', 'client', 'index.html');
const content = fs.readFileSync(htmlPath, 'utf8');

console.log('--- Validating client/index.html ---');

// 1. Check title & meta
assert(content.includes('<title>Champions Club'), 'Contains valid document title');
assert(content.includes('name="viewport"'), 'Contains responsive viewport meta');

// 2. Check CSS assets
assert(content.includes('href="/css/main.css"'), 'References /css/main.css');
assert(fs.existsSync(path.join(__dirname, '..', '..', 'client', 'css', 'main.css')), 'main.css exists on disk');

assert(content.includes('href="/landing/landing.css"'), 'References /landing/landing.css');
assert(fs.existsSync(path.join(__dirname, '..', '..', 'client', 'landing', 'landing.css')), 'landing.css exists on disk');

// 3. Check JS assets
assert(content.includes('src="/landing/landing.js"'), 'References /landing/landing.js');
assert(fs.existsSync(path.join(__dirname, '..', '..', 'client', 'landing', 'landing.js')), 'landing.js exists on disk');

// 4. Check Section IDs for smooth scroll navigation
assert(content.includes('id="facilities"'), 'Section #facilities exists');
assert(content.includes('id="membership"'), 'Section #membership exists');
assert(content.includes('id="booking"'), 'Section #booking exists');
assert(content.includes('id="experience"'), 'Section #experience exists');
assert(content.includes('id="contact"'), 'Section #contact exists');

// 5. Check Membership Tier mentions
assert(content.includes('Gold Tier') && content.includes('₹24,000'), 'Gold Tier with ₹24,000 present');
assert(content.includes('Silver Tier') && content.includes('₹12,000'), 'Silver Tier with ₹12,000 present');
assert(content.includes('Junior Tier') && content.includes('₹6,000'), 'Junior Tier with ₹6,000 present');

// 6. Check Courts mentioned
assert(content.includes('Court A – Tennis'), 'Court A – Tennis present');
assert(content.includes('Court B – Tennis'), 'Court B – Tennis present');
assert(content.includes('Cricket Net 1'), 'Cricket Net 1 present');
assert(content.includes('Badminton Hall 1'), 'Badminton Hall 1 present');

// 7. Check Links to member login
assert(content.includes('href="/shared/login.html"'), 'Valid links to /shared/login.html');
assert(fs.existsSync(path.join(__dirname, '..', '..', 'client', 'shared', 'login.html')), 'login.html exists on disk');

// 8. Check Lead Form
assert(content.includes('id="landingContactForm"'), 'Inquiry form id landingContactForm exists');
assert(content.includes('id="contactName"'), 'Input contactName exists');
assert(content.includes('id="contactEmail"'), 'Input contactEmail exists');
assert(content.includes('id="contactPhone"'), 'Input contactPhone exists');

// 9. Check Footer
assert(content.includes('landing-footer'), 'Landing footer exists');
assert(content.includes('© 2026 Champions Club'), 'Copyright statement exists');

console.log('\nAll HTML validations passed successfully!');
