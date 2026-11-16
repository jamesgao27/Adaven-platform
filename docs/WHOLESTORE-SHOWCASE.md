# Wholestore Showcase (simplified · our-pies)

## Layout

Three bands, inspired by [pouchpies.com/pages/our-pies](https://www.pouchpies.com/pages/our-pies):

1. **Top** — small image strip (`posters.top_image_url`)
2. **Middle** — SKUs from `poster_skus` (order = `sort_order`), grid/list toggle, optional **category** chips
3. **Bottom** — small image strip (`posters.bottom_image_url`)

Accent color: `posters.accent_color` (buttons / chips).

## Vendor config (Marketing / Showcases)

Per showcase, configure only:

- Name / intro, Published, Featured (Discover)
- Accent color
- Top / bottom images (`marketplace` bucket `poster/{id}/top|bottom.jpg`)
- Published catalog SKUs + order
- Assign approved dealers (each dealer has **one** showcase via `consumers.poster_id`)

## Dealer view

- `provider.get_dealer_storefront(consumer_space, provider_space)` resolves showcase: assigned → featured → default.
- Enrolled dealers: SKUs = showcase ∩ price list ∩ published; can place orders.
- Discover / not enrolled: same bands for browse; Apply only (no order).

## Schema

See `packages/db-platform/sql/040_wholestore_showcase_bands.sql`.

- `posters.accent_color`, `top_image_url`, `bottom_image_url`
- `skus.category` (optional tag for middle-band chips)
- RPCs: `resolve_dealer_showcase_id`, `assign_showcase_to_consumer`, `get_dealer_storefront`
- Open invite accept persists `consumers.poster_id`

## Out of scope

- Collection / FAQ / Steps page builders
- Orderable gift boxes / bundles
