# Decision 0009: Estimate a missing food from text

Date: 21 October 2026

## User flow

Search All foods first. Once that specific search finishes with no result, show Estimate with AI for the typed name. Opening the form is free of inference calls. The person can optionally enter grams, a range, bowls/pieces, recipe details, or “not sure,” then explicitly submit Estimate meal. Review and confirmation reuse the photo-meal interface, with editable nutrition and up to two optional follow-up attempts.

## Architecture

A shared food-inference service owns Gemini calls, quota reservation, safe error mapping, AI-run usage, and signed drafts. Text requests contain a name and bounded context; no image is needed. Both modes keep the existing 4,096-token/30-second limits and the shared rolling account quota. User text and image content are untrusted data, the model has no tools, and code validates finite nonnegative nutrition/portions before any confirmed write.

The existing database run kind food_vision is retained as the food-inference bucket. Input snapshot type and prompt/schema versions distinguish text and photo calls. Only lengths/type metadata are stored for unconfirmed inputs. Draft signing binds source type to the account and completed run, with default photo interpretation for legacy drafts. The existing confirmation endpoint serves both modes.

## Private reuse and provenance

The optional Save to My foods checkbox writes private foods and food-log snapshots in a single transaction. Stable record IDs and retry comparison cover the selected batch. The cache uses the existing user_foods table and its two-decimal nutrient precision. A server-written AI estimate (unverified). source-note prefix preserves origin without a migration. Search exposes this flag; future manual logs copy estimated provenance. For single-dish text requests, the submitted name is retained as a private alias if the model uses a different name. Saved estimates appear in All foods and Recent and use normal database logging with no AI call. Different recipe variants can remain separate private entries.

New records use generic foodEstimate metadata plus a nutritionProvenance marker. Old photoEstimate metadata remains readable; photo records also retain that compatibility metadata. Estimate ranges use the midpoint for logged totals and keep endpoints and certainty. These estimates do not become reviewed shared catalog entries or verified allergen/dietary claims.

No new environment variables or database migrations are needed. Checks, builds, browser verification, and live inference were not run at the owner's request.
