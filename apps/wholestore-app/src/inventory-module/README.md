# Inventory module (not wired)

These screens were removed from Vouchap and Portalflow. Neither product keeps inventory.

The files still import `@/` paths from the bookkeeping app. Wire them into Wholestore before using them. Do not mount them in `portalflow-app`.

Vouchap and Portalflow databases no longer have `public.inbound`, `public.outbound`, `public.warehouse`, `public.location`, or `public.skus`. Firm service templates stay in `provider.skus`.
