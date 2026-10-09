---
description: "Editor color schemes for the dsh web client, Everforest by default, chosen in General Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme-pack

English | [中文](README.zh.md)

## Summary

DSH Pro recolors the Web UI with a well-known editor scheme: Everforest until the browser stores another choice, plus Gruvbox, Catppuccin, Rosé Pine, Tokyo Night, Nord, Solarized, Kanagawa, and GitHub. **Settings → General → Color theme** switches schemes or returns to the built-in palette. Each scheme has a light and a dark palette, so the Appearance row still picks light, dark, or system.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The web-app bundle composes this plugin, so every Web profile starts in Everforest. Open **Settings → General → Color theme** and click a card to switch at once; **Default** removes the recoloring. The choice is stored in this browser's `localStorage` under `dsh-theme-pack`, so another browser or device starts from Everforest until it chooses. Every surface that paints with the `--dsw-alias-*` tokens follows the scheme, including dialogs such as the first-run welcome.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. `palettes.ts` holds each scheme's palettes and maps them onto alias tokens, `--dsw-specific-*` surfaces, and the Shiki code tokens as `{ light, dark }` pairs; missing state tints derive from the base and accent colors. The browser half passes that layer to `ctx.theme.overrideTokens` under its package id, replaces it on every choice, and removes it for **Default** and when the fiber leaves. The General row reads the choice through an injected snapshot store and registers at order 10.5, after Appearance.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-theme](../ui-theme/README.md) — the theme runtime, its alias tokens, and the override layers this package stacks.
- [ui-settings-general](../ui-settings-general/README.md) — the General section and its `settings.general.item` slot.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side color layer that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Browser-local choice** — the scheme is not part of the profile's settings, so each browser chooses independently.
- **Runtime invariant:** No companion is published. The package owns no relationship beyond the one override layer the theme runtime already tracks per source.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
