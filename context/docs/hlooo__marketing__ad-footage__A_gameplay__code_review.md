# HyperFrame Schema Compliance Review

## Executive Summary
- Total files reviewed: 6
- Critical issues: 0
- Overall compliance status: NEEDS_WORK

The project is largely compliant with the HyperFrame schema, following the modular composition structure and deterministic animation rules. However, there are several discrepancies between the implementation, the storyboard, and the design system (frame.md) that need to be addressed.

## Critical Issues
None. The compositions are deterministic, timelines are finite, and registration is correct.

## Compliance Checklist
- [x] All compositions have `data-width` and `data-height` attributes
- [x] All timelines are finite with duration > 0
- [x] All compositions registered in `window.__timelines`
- [x] No use of `Math.random()`, `Date.now()`, or non-deterministic code
- [x] Primitive clips have required data attributes (`id`, `data-start`, `data-track-index`)
- [x] `data-duration` specified for all `<img>` clips (N/A - images used as managed DOM elements)
- [x] No manual media playback control (`video.play()`, `audio.pause()`, etc.)
- [x] No manual clip mounting/unmounting in scripts
- [x] Relative timing references are valid (N/A - absolute timing used)
- [x] Clips on same track don't overlap in time
- [ ] CSS `z-index` is set on clips to control visual layering (`data-track-index` does NOT affect z-index)
- [x] Reusable compositions in separate HTML files
- [x] Composition files use `<template>` tags
- [x] External compositions loaded via `data-composition-id-src`
- [x] All script-animated content wrapped in compositions
- [x] No infinite or zero-duration timelines

## Findings

### Visual Verification
- **Status**: PASS
- **Observation**: Snapshots confirm that all beats render their primary visual content correctly. Beat 3's "2.5ms" stat and Beat 4's feature panels are clearly visible and correctly styled. Beat 5's CTA buttons and logo are properly centered.

### [index.html]
**Status**: HAS_ISSUES

**Issues Found**:
- **Duration Discrepancy (Line 114)**: `beat-5-cta` is assigned a duration of `8.1s`, but `STORYBOARD.md` and the composition file itself (`beat-5-cta.html`) specify `8.0s`.
- **Total Duration Discrepancy (Line 59)**: The root composition `data-duration` is set to `35.6s`, while `STORYBOARD.md` and `SCRIPT.md` specify a total length of `35.5s`.
- **Missing Z-Index (Line 61-118)**: Top-level composition clips (scenes) do not have explicit `z-index` set. While they are mostly sequential, the schema requires `z-index` for explicit layering control, especially during transitions.
- **Placeholder Audio (Line 121-133)**: `lint` and `validate` report missing audio files. These are expected placeholders (`<<token>>`) and do not constitute a schema violation per instructions.

### [compositions/beat-1-hook.html]
**Status**: COMPLIANT

**Issues Found**:
- **Static Analysis Coverage**: Machine checks report low timeline coverage (46%). This is a false positive caused by the static analyzer failing to resolve the `BEAT` variable used for the primary camera dolly duration. The animation actually covers the full 6.5s.

### [compositions/beat-3-latency.html]
**Status**: COMPLIANT

**Issues Found**:
- **Static Analysis Coverage**: Machine checks report low timeline coverage (51%). Similar to Beat 1, the primary camera move uses the `BEAT` variable which is not resolved by static analysis.

### [compositions/beat-4-features.html]
**Status**: HAS_ISSUES

**Issues Found**:
- **Design System Violation (Line 109)**: The headline font-size is set to `54px`. `frame.md` specifies that `heading` should be `5cqw` (which resolves to `96px` at 1920px width). The `verify` tool flags this as being below the `80px` floor for headlines.
- **Template ID (Line 1)**: The `<template>` tag has an `id="beat-4-features-template"`. While not a violation, it is inconsistent with the other compositions which use anonymous templates.

### [compositions/beat-5-cta.html]
**Status**: COMPLIANT

**Issues Found**:
- **Duration Discrepancy (Line 165)**: `data-duration` is `8.0`, which matches the storyboard but mismatches the `8.1` assigned in `index.html`.

## Recommendations
1. **Sync Durations**: Update `index.html` to match the `35.5s` total duration and `8.0s` duration for Beat 5 as defined in `STORYBOARD.md`.
2. **Fix Headline Size**: Increase the headline font-size in `beat-4-features.html` to at least `80px` (ideally `96px` to match `frame.md`).
3. **Add Z-Index**: Add explicit `z-index` to the scene containers in `index.html` to ensure reliable layering during transitions.
4. **Standardize Templates**: Remove the ID from the template in `beat-4-features.html` for consistency.