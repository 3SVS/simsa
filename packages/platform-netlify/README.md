# @simsa/platform-netlify

Netlify adapter. Mirrors the `Platform` contract from
`@simsa/platform-vercel`; same API pattern.

## Env

| Var | Required |
|---|---|
| `NETLIFY_TOKEN` | ✓ |
| `NETLIFY_SITE_ID` | ✓ |

```ts
import { NetlifyPlatform } from "@simsa/platform-netlify";
const netlify = new NetlifyPlatform({
  token: process.env.NETLIFY_TOKEN,
  siteId: process.env.NETLIFY_SITE_ID,
});
```
