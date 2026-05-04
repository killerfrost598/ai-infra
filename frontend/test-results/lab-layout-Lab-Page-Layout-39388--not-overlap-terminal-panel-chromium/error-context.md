# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lab-layout.spec.ts >> Lab Page Layout Bugs >> RED: sidebar should not overlap terminal panel
- Location: tests\e2e\lab-layout.spec.ts:97:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.boundingBox: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-sidebar="provider"] > div > main').first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary:
      - generic [ref=e3]:
        - generic [ref=e5]:
          - img [ref=e7]
          - generic [ref=e9]:
            - generic [ref=e10]: AIP
            - generic [ref=e11]: Inference Platform
        - generic [ref=e14]:
          - generic [ref=e15]: Navigation
          - list [ref=e17]:
            - listitem [ref=e18]:
              - link "Overview" [ref=e19] [cursor=pointer]:
                - /url: /
                - img [ref=e20]
                - generic: Overview
            - listitem [ref=e25]:
              - link "Servers" [ref=e26] [cursor=pointer]:
                - /url: /servers
                - img [ref=e27]
                - generic: Servers
            - listitem [ref=e30]:
              - link "Deployments" [ref=e31] [cursor=pointer]:
                - /url: /deployments
                - img [ref=e32]
                - generic: Deployments
            - listitem [ref=e36]:
              - link "Playbooks" [ref=e37] [cursor=pointer]:
                - /url: /playbooks
                - img [ref=e38]
                - generic: Playbooks
            - listitem [ref=e40]:
              - link "Clore" [ref=e41] [cursor=pointer]:
                - /url: /clore
                - img [ref=e42]
                - generic: Clore
            - listitem [ref=e44]:
              - link "Task Runs" [ref=e45] [cursor=pointer]:
                - /url: /task-runs
                - img [ref=e46]
                - generic: Task Runs
            - listitem [ref=e48]:
              - link "API Keys" [ref=e49] [cursor=pointer]:
                - /url: /api-keys
                - img [ref=e50]
                - generic: API Keys
            - listitem [ref=e54]:
              - link "Benchmarks" [ref=e55] [cursor=pointer]:
                - /url: /benchmarks
                - img [ref=e56]
                - generic: Benchmarks
            - listitem [ref=e57]:
              - link "Lab" [ref=e58] [cursor=pointer]:
                - /url: /lab
                - img [ref=e59]
                - generic: Lab
            - listitem [ref=e61]:
              - link "Settings" [ref=e62] [cursor=pointer]:
                - /url: /settings
                - img [ref=e63]
                - generic: Settings
        - generic [ref=e68]:
          - paragraph [ref=e69]: v0.2.0 · Clore.ai + vLLM
          - button "Switch to light mode" [ref=e70]:
            - img [ref=e71]
        - button "Toggle Sidebar" [ref=e77]
    - main [ref=e78]:
      - main [ref=e79]:
        - generic [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - heading "Lab" [level=1] [ref=e83]
              - paragraph [ref=e84]: Interactive terminal + command history
            - generic [ref=e85]:
              - button "Refresh" [ref=e86]
              - button "Sessions" [ref=e87]
          - generic [ref=e88]:
            - paragraph [ref=e89]: Select a session to begin terminal work.
            - button "Open Sessions" [ref=e90]
          - generic:
            - button "Close sessions drawer"
            - complementary:
              - generic:
                - generic:
                  - generic:
                    - heading "Sessions" [level=2]
                    - paragraph: Open a session in Lab
                  - generic:
                    - button "Refresh"
                    - button "Close"
                - generic:
                  - generic: No sessions available.
  - region "Notifications alt+T"
  - alert [ref=e91]
```

# Test source

```ts
  16  |             commands: [{
  17  |               command: 'echo test',
  18  |               exit_code: 0,
  19  |               duration_ms: 100,
  20  |               started_ms: Date.now(),
  21  |               output: 'Test output\n'.repeat(30)
  22  |             }]
  23  |           })
  24  |         });
  25  |       } else if (url.match(/sessions\/[^/]+$/)) {
  26  |         await route.fulfill({
  27  |           status: 200,
  28  |           contentType: 'application/json',
  29  |           body: JSON.stringify({
  30  |             id: 'test-session-123',
  31  |             status: 'ACTIVE',
  32  |             pty_log: 'Long PTY log content that should fill the container...\n'.repeat(50),
  33  |             server_id: 'server-123',
  34  |             label: 'Test Session',
  35  |             started_at: new Date().toISOString()
  36  |           })
  37  |         });
  38  |       } else {
  39  |         await route.fulfill({
  40  |           status: 200,
  41  |           contentType: 'application/json',
  42  |           body: JSON.stringify({
  43  |             items: [{
  44  |               id: 'test-session-123',
  45  |               label: 'Test Session',
  46  |               status: 'ACTIVE',
  47  |               server_id: 'server-123',
  48  |               server_hostname: 'test-server',
  49  |               command_count: 5,
  50  |               started_at: new Date().toISOString()
  51  |             }],
  52  |             total: 1
  53  |           })
  54  |         });
  55  |       }
  56  |     });
  57  | 
  58  |     // Navigate to lab page with session
  59  |     await page.goto('/lab?session=test-session-123');
  60  |     
  61  |     // Wait for the terminal view panel to render
  62  |     await page.waitForSelector('[data-testid="terminal-view-panel"]', { timeout: 10000 });
  63  | 
  64  |     // Click History tab
  65  |     await page.click('button:has-text("History")');
  66  |     await page.waitForTimeout(500);
  67  | 
  68  |     // Get the tab content and parent panel dimensions
  69  |     const historyContent = page.locator('[data-testid="history-content"]');
  70  |     const parentPanel = page.locator('[data-testid="terminal-view-panel"]');
  71  |     
  72  |     await expect(historyContent).toBeVisible();
  73  |     
  74  |     const contentBox = await historyContent.boundingBox();
  75  |     const parentBox = await parentPanel.boundingBox();
  76  | 
  77  |     // ASSERTION: This should FAIL because max-h-96 limits height
  78  |     // The content should fill most of parent (minus tab nav ~40px)
  79  |     if (contentBox && parentBox) {
  80  |       const tabNavHeight = 45; // tabs header height
  81  |       const padding = 40; // generous tolerance
  82  |       const expectedMinHeight = parentBox.height - tabNavHeight - padding;
  83  |       
  84  |       console.log('History content height:', contentBox.height);
  85  |       console.log('Parent panel height:', parentBox.height);
  86  |       console.log('Expected min height:', expectedMinHeight);
  87  |       console.log('max-h-96 is ~384px, if content < 384px this is the bug');
  88  |       
  89  |       // This WILL FAIL with current code due to max-h-96 (~384px)
  90  |       // When parent is tall (say 600px), content should be ~555px but is capped at 384px
  91  |       expect(contentBox.height).toBeGreaterThanOrEqual(expectedMinHeight);
  92  |     } else {
  93  |       throw new Error('Could not get bounding boxes');
  94  |     }
  95  |   });
  96  | 
  97  |   test('RED: sidebar should not overlap terminal panel', async ({ page }) => {
  98  |     // Mock minimal API
  99  |     await page.route('**/api/v1/sessions*', async (route) => {
  100 |       await route.fulfill({
  101 |         status: 200,
  102 |         body: JSON.stringify({ items: [], total: 0 })
  103 |       });
  104 |     });
  105 | 
  106 |     await page.goto('/lab');
  107 |     await page.waitForTimeout(1000); // Let page fully render
  108 |     
  109 |     // Find the app sidebar and the SidebarInset (should be the first main)
  110 |     const sidebar = page.locator('[data-sidebar="sidebar"]');
  111 |     const inset = page.locator('[data-sidebar="provider"] > div > main').first();
  112 |     
  113 |     await expect(sidebar).toBeVisible();
  114 |     
  115 |     const sidebarBox = await sidebar.boundingBox();
> 116 |     const insetBox = await inset.boundingBox();
      |                                  ^ Error: locator.boundingBox: Test timeout of 30000ms exceeded.
  117 | 
  118 |     // ASSERTION: Inset should start after sidebar, no overlap
  119 |     if (sidebarBox && insetBox) {
  120 |       console.log('Sidebar right edge:', sidebarBox.x + sidebarBox.width);
  121 |       console.log('Inset left edge:', insetBox.x);
  122 |       
  123 |       // Inset's left edge should be >= sidebar's right edge
  124 |       expect(insetBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 5); // 5px tolerance
  125 |     } else {
  126 |       throw new Error('Could not get bounding boxes for sidebar or inset');
  127 |     }
  128 |   });
  129 | });
  130 | 
  131 | 
  132 | 
```