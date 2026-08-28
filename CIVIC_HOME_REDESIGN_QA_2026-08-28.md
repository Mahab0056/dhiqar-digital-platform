# Civic Home Redesign QA — 2026-08-28

## Direction

The previous home hero used oversized typography, two competing photographs, sharp clipped shapes, and a large dark metrics bar. The revised direction uses a quieter institutional composition: one local heritage image, a restrained green-and-sand palette, clear service-first hierarchy, a search surface, and light factual indicators.

## Visual review

| Viewport | Result | Observations |
|---|---|---|
| Desktop — 1440 × 1100 | Pass | The hero has one focal image, an institutional headline, visible search controls, two clear CTAs, compact quick-service cards, and restrained factual indicators. The title no longer competes with the image or runs into the search surface. |
| Mobile — 390 × 844 | Pass | The government header, Arabic headline, CTAs, heritage image, and start of the search control stack in a clear mobile-first sequence. No horizontal clipping or overlapping controls is visible. |

## Functional preservation

The home search still filters the existing service catalog and directs to the first matching service. A browser interaction check confirmed that the query `إجازة محل` returns and opens `/service/store-license`, and that the sector filter `المحلات والأعمال` operates correctly. The quick cards retain their established local and official-national service routes. Indicator values remain based on the service catalog, government entity directory, displayed news records, and QR verification route; no population, transaction, or performance figures were introduced.

## Publication gate

The redesign remains local until explicit publication confirmation is received.
