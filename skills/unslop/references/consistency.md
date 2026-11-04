# Consistency across screens

Use this when controls repeat, a shared component changes, or the request covers related screens. A polished page can still feel unfamiliar if its inputs, lists and actions follow different rules from the rest of the product. Carry consistency through the existing nine passes, rather than adding another redesign process.

## Find the established pattern

Inspect the requested screen and relevant siblings before inventing another control. Look for existing components, style classes, tokens, icon mappings and size variants. Prefer the pattern that is already established and works well, not automatically the first instance you find.

Compare equivalent roles:

- **Inputs:** label, control, help/error text, required and disabled states, validation feedback and units
- **Lists:** content columns, row insets, minimum height, wrapping, status and action placement
- **Actions:** icon, label, emphasis, hit area, placement and keyboard focus
- **Page structure:** heading, primary action, return navigation, editor and confirmation patterns
- **States:** loading, empty, error/retry, saving and successful completion

Record concrete differences in the audit: the role, affected locations, existing primitive or token, and whether the difference is accidental or an intended variant. Two representative examples may establish the issue; a small request does not need a full design-system inventory.

Reading nearby pages supplies comparison evidence. Keep edits within the requested scope; report unrelated drift rather than silently redesigning the application.

## Reuse the source of the pattern

Fix an established shared component or token before copying its markup into another page. In a framework, reuse the relevant component; in plain HTML/CSS, use common classes and variables. Remove accidental local overrides instead of adding another compensating override.

If repeated controls have no shared primitive, extract the smallest useful one when the scope supports it. Do not introduce a component library, framework migration or large design-system rewrite just to make two controls agree.

Keep deliberate variants explicit:

- A dense table and a regular form can use different established size variants
- Navigation rows, radio options and rows with separate actions can share typography and spacing without sharing interactive semantics
- Long labels and narrow viewports can increase row height; equal minimum height and insets do not require clipping content
- Destructive actions can use semantic emphasis that ordinary actions do not

Apply the chosen variant consistently to equivalent uses. A different page or resource name alone is not a reason for a different control.

## Match action icons in the rendered UI

Map the action's meaning to a shared glyph. Creation actions should not acquire unrelated icons on different resource pages. Keep deletion distinct from closing a view. Use the project's existing icon family rather than adding another set.

The same SVG name does not guarantee the same appearance. Compare:

- Actual rendered width and height, view box and stroke
- Inherited CSS, explicit size props and flex shrink
- Icon box, label baseline, gap and optical alignment
- Button padding, hit area and disabled/loading treatment

Check at the same viewport and density. Fix the shared icon/control or remove the local override; do not make isolated margin nudges until two screenshots happen to match.

## Keep interactions familiar

Within equivalent flows, keep primary, secondary and destructive actions in predictable positions. Match labels to their outcome: dismissing a dialog, cancelling an edit and navigating back are different operations, even when they occupy a similar place.

Preserve native links, buttons and selection controls, keyboard behavior, accessible names and focus feedback. A list that navigates should not become a set of radio options just to share styling. Reusing a visual row must not create nested interactive targets.

Compare state transitions as well as the resting view: where focus moves when an editor opens, how errors attach to inputs, what stays visible while saving, and where completion returns the user. Keep loading distinct from empty data and failure; a retry should target the failed step.

Do not change navigation, validation, submission, unsaved-change handling or destructive-action policy as an incidental styling fix. Identify behavioral inconsistencies separately in the audit and address them only within the authorized work.

## Verify the affected consumers

Render representative uses of the changed primitive side by side at matching viewport sizes and states. Include a narrow layout, long content and relevant focus, disabled, loading or error states. A change to a shared component needs checks beyond the first page where the issue was noticed.

Inspect the rendered result, not only the component name or source props. Use computed styles when identical markup looks different. Run existing relevant checks, and verify interactions when behavior changed; do not add a large test suite merely to assert a styling value.

Report the canonical pattern used, which consumers were checked, intentional differences and any coverage gaps. Do not claim the whole application is consistent after checking one screen.

---

Part of [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Keep this credit in copies and adaptations.
