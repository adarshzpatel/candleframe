# Security policy

## Supported versions

CandleFrame is pre-1.0. Only the latest release gets security fixes.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

Include the affected version, the steps to reproduce, and what an attacker gains. You should get a reply within 7 days. Once a fix ships, the advisory is published with credit to you, unless you ask to stay anonymous.

## Scope

In scope: code in `src/`, which ships in the npm package. Examples, demo and docs-site code are in scope if the issue reaches a user who runs them unchanged.

Out of scope:

- Custom indicator and plugin code. The plugin contract runs host code with full page access and is not a sandbox for untrusted scripts.
- Data that a feed adapter you wrote passes to the chart.
- Availability or terms of third-party market-data APIs.
