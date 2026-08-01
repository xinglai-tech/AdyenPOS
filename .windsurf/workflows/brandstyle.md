---
description: Restyle the UI after a named brand using the design-md skill
---

Usage: `/brandstyle <brand>` — for example `/brandstyle apple`, `/brandstyle linear.app`.

The brand argument is whatever follows the command. If it is missing, ask which brand
before doing anything else; do not pick one silently.

## 1. Resolve the brand

Match the argument to a directory under
`/Users/xinglai/.codeium/windsurf/skills/design-md/design-md/`.

Names are exact. The ones that trip people up carry a TLD (`linear.app`, `x.ai`,
`mistral.ai`, `opencode.ai`, `together.ai`) or a year (`dell-1996`, `nintendo-2001`).
Never guess a path — if the argument does not match a directory, list the near misses
and ask.

If the user gave a feeling rather than a name ("clean developer tool", "playful
consumer app"), propose two or three candidates and let them choose. Read the
`README.md` in each candidate folder to compare them.

One brand only. These systems are mutually exclusive and blending two produces
something that looks like neither. If a blend is requested, ask which one leads.

## 2. Read the file in full

```
/Users/xinglai/.codeium/windsurf/skills/design-md/design-md/<brand>/DESIGN.md
```

Read all of it, including the Do's and Don'ts and the Iteration Guide. Do not work
from memory of what the brand looks like — the value of this collection is the
specific tokens, not a general impression.

## 3. Declare the lookup

Before writing any code, output this on its own line:

```
Using design-md: <brand> (design-md/<brand>/DESIGN.md)
```

This is the signal that separates a real lookup from a guess. It is not optional.

## 4. Survey the codebase before editing

Read the existing stylesheet and note:

- Design tokens that already exist. Adapt the brand's ideas onto them rather than
  replacing a working system. Existing project conventions win.
- Comments that record a past bug or a tuned constraint. This repo's CSS explains why
  particular widths, clamps and font sizes are what they are; those are load-bearing.
- Whether the surface is a marketing page or a dense application. Most DESIGN.md files
  are reverse-engineered from a brand's **marketing site**, so their section padding,
  body size and whitespace rules will wreck an information-dense UI. Take the colour,
  radius, motion and component grammar; treat the layout scale as advisory.

## 5. Report the plan before the diff

Split the proposed changes into three buckets and show them to the user:

- **Safe** — values that can move with no layout or contrast consequence.
- **Contrast risk** — anything where the brand's colour on the brand's own tint fails
  WCAG AA. Brand files specify saturated accents that are meant for fills and glyphs;
  the same hex as small text on a 10% wash of itself routinely lands near 2:1. Compute
  the ratio rather than assuming, and derive a darker "ink" variant for text.
- **Do not touch** — constraints the codebase has already solved.

Wait for the user to choose a bucket unless they have said to go ahead.

## 6. Verify

// turbo
```
node -e "const c=require('fs').readFileSync('public/css/style.css','utf8');let d=0;for(const ch of c){if(ch==='{')d++;if(ch==='}')d--}console.log('brace depth',d)"
```

// turbo
```
node -e "
const css=require('fs').readFileSync('public/css/style.css','utf8');
const defined=new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gmi)].map(m=>m[1]));
const used=new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map(m=>m[1]));
console.log('undefined:', [...used].filter(v=>!defined.has(v)));
console.log('unused:', [...defined].filter(v=>!used.has(v)));
"
```

// turbo
```
npm test
```

Then bump `CACHE_NAME` in `public/sw.js` so the service worker picks up the new
assets, and tell the user which states to exercise to actually see the change —
colour work usually lands on toasts, badges and error paths that an idle screen
never renders.
