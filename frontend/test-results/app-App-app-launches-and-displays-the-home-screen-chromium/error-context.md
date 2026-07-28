# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> App >> app launches and displays the home screen
- Location: e2e/app.spec.ts:4:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Learn Nodes')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Learn Nodes')

```

```yaml
- heading "Internal Server Error" [level=1]
- 'heading "EPERM: operation not permitted, open ''/Users/raikonif/Desktop/Projects/personal/learn-nodes-personalized/frontend/index.html''" [level=2]'
- text: at async open (node:internal/fs/promises:642:25) at async Object.readFile (node:internal/fs/promises:1279:14) at async viteIndexHtmlMiddleware (file:///Users/raikonif/Desktop/Projects/personal/learn-nodes-personalized/frontend/node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js:37782:22)
- paragraph: (Error overlay failed to load)
```