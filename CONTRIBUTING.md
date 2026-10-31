# Contributing to unslop

Fix the craft, keep the product. Every contribution should make interfaces clearer, faster, or more accessible—never more decorative.

## Where to contribute
- **Signs & tokens**: Common AI tells and fixes in [`skills/unslop/references/signs.md`](skills/unslop/references/signs.md) or accessible scales in [`skills/unslop/references/tokens.md`](skills/unslop/references/tokens.md)
- **Skill instructions**: Pass refinements in [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) to improve agent compliance, performance, or accessibility
- **Scripts**: Improvements to [`snapshot.mjs`](skills/unslop/scripts/snapshot.mjs) or [`story.mjs`](skills/unslop/scripts/story.mjs)
- **Examples**: Minimal before-and-after test screens in [`examples/`](examples)

## Pull request rules
1. **Actionable and direct**: Specific values and exact syntax (`Animate ONLY transform and opacity`), never vague design advice
2. **No bloat**: Target repeated failure modes in real AI-generated code rather than speculative edge cases
3. **Performance and accessibility**: Preserve Core Web Vitals, user font scaling, Dynamic Type, and WCAG AA contrast
4. **Verified**: Test prompt adjustments against sample screens and verify scripts execute cleanly

## License
Contributions are licensed under [CC BY 4.0](LICENSE) with attribution to Damir Sokolovsky ([@heydamir](https://x.com/heydamir)).
