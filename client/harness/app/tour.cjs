// Walks routes and reports, per route: unanswered API calls (fixture gaps),
// page errors, and horizontal overflow. Screenshots land in $OUT (default /tmp).
//   node tour.cjs [--w 390] [--dark] /route /route ...
const { open, B } = require('./drive.cjs');
const args = process.argv.slice(2);
const w = args.includes('--w') ? Number(args[args.indexOf('--w') + 1]) : 1440;
const dark = args.includes('--dark');
const routes = args.filter((a, i) => a.startsWith('/') && args[i - 1] !== '--w');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const { browser, page, log } = await open({ viewport: { width: w, height: w < 500 ? 844 : 900 }, dark });
  for (const r of routes) {
    log.requests.length = 0; log.errors.length = 0;
    await page.goto(B + r, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const crashed = await page.evaluate(() => /Something went wrong|hit a snag/i.test(document.body.innerText));
    const name = `${w}${dark ? 'd' : ''}${r.replace(/[\/?=&:]/g, '_')}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const gaps = log.requests.filter((x) => x.endsWith('DEFAULT'));
    const errs = log.errors.filter((e) => !/ERR_CERT|Failed to load resource|Download the React DevTools/.test(e));
    console.log(`== ${r}  overflow=${over}${crashed ? '  CRASHED' : ''}`);
    if (gaps.length) console.log('  gaps: ' + [...new Set(gaps)].join(' | '));
    for (const e of [...new Set(errs)].slice(0, 4)) console.log('  err: ' + e.split('\n')[0].slice(0, 220));
  }
  await browser.close();
})();
