// Karma configuration for `ng test`.
//
// Chrome comes from the puppeteer devDependency (chrome-headless-shell),
// so tests run anywhere `npm install` succeeds — no system Chrome needed.
// Override with CHROME_BIN to use a local Chrome instead.
//
// Note: puppeteer 23+ made executablePath() async, and this config file is
// loaded synchronously, so the binary is located by scanning the puppeteer
// cache directory instead of calling the API.
const fs = require('fs');
const path = require('path');

function findCachedChrome() {
  const cacheRoot = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.cache',
    'puppeteer',
  );
  const layouts = [
    ['chrome-headless-shell', 'chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-headless-shell', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
    ['chrome-headless-shell', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
    ['chrome-headless-shell', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
    ['chrome', 'chrome-linux64', 'chrome'],
    ['chrome', 'chrome-mac-arm64', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    ['chrome', 'chrome-mac-x64', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    ['chrome', 'chrome-win64', 'chrome.exe'],
  ];
  for (const [browser, platformDir, binary] of layouts) {
    const dir = path.join(cacheRoot, browser);
    if (!fs.existsSync(dir)) {
      continue;
    }
    const versions = fs.readdirSync(dir).sort().reverse();
    for (const version of versions) {
      const candidate = path.join(dir, version, platformDir, binary);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

process.env.CHROME_BIN = process.env.CHROME_BIN || findCachedChrome();

module.exports = function (config) {
  config.set({
    // NOTE: no basePath/files here — the Angular builder injects those
    // (output dir + spec bundles). The test target also sets
    // "builderMode": "application" in angular.json: the karma builder's
    // default webpack mode needs the legacy test.ts entry point, and with
    // a custom karma.conf.js the webpack test-discovery plugin is absent,
    // which silently results in 0 tests executed.
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: {
      clearContext: false,
    },
    jasmineHtmlReporter: {
      suppressAll: true,
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/frontend-angular'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
        ],
      },
    },
    restartOnFileChange: true,
  });
};
