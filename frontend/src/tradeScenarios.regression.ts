import { buildSavedTradeScenarioExportPayload, clearVisibleSavedTradeScenarios, duplicateSavedTradeScenario, mergeImportedSavedTradeScenarioResult, normalizeSavedTradeScenarios, restoreSavedTradeScenario, restoreSavedTradeScenarios, retainSavedTradeScenarios, savedTradeScenarioCopyName, savedTradeScenarioFilterCounts, savedTradeScenarioFilterKey, savedTradeScenarioMatchesFilter, savedTradeScenarioMatchesQuery, savedTradeScenarioSides, savedTradeScenarioViewIsDefault, savedTradeScenarioViewSummary, sortSavedTradeScenarios, upsertSavedTradeScenario } from "./tradeScenarios";
import type { PickAsset, PlayerImpact } from "./types";

export function runTradeScenarioRegressionTests(): string[] {
  return [
    importWrappedScenarioWithSyntheticPickCashAndCalendar(),
    importLegacySavedScenariosPayload(),
    importRehydratesKnownPlayerFromMap(),
    importRehydratesKnownPicksFromTradeAssetIds(),
    importRejectsEmptyAndInvalidDeals(),
    savedScenarioSearchAndFilterBuckets(),
    duplicateSavedScenarioBranchesWithUniqueName(),
    savedScenarioSortingOrdersSavedDeals(),
    pinnedScenarioRetentionProtectsPinnedDeals(),
    restoreSavedScenarioReinstatesDeletedDeal(),
    clearVisibleSavedScenariosProtectsPinnedDeals(),
    savedScenarioExportPayloadTracksVisibleScope(),
    savedScenarioUpdatePreservesPinnedMetadata(),
    importedScenarioMergePreservesLocalMetadata(),
    savedScenarioViewDefaultDetectionTracksFilterQueryAndSort(),
    savedScenarioViewSummaryLabelsVisibleCounts()
  ];
}

function importWrappedScenarioWithSyntheticPickCashAndCalendar(): string {
  const imported = normalizeSavedTradeScenarios({
    version: 1,
    scenarios: [{
      id: "deal-1",
      name: "Deadline swing",
      createdAt: "2027-01-20T12:00:00.000Z",
      userNote: "Check wing-defense hedge at the deadline",
      pinned: true,
      left: {
        team: "ATL",
        assets: [
          {
            kind: "pick",
            id: "pick-generic-pick-2029-r1-0-local",
            pick: pick("generic-pick-2029-r1-0", "2029 Unprotected 1st")
          },
          { kind: "cash", id: "cash-1", cashAmount: 2_500_000, toTeam: "BKN" }
        ]
      },
      right: { team: "BKN", assets: [] },
      third: {
        team: "DAL",
        assets: [{ kind: "cash", id: "cash-2", cashAmount: 1_000_000, toTeam: "ATL" }]
      },
      calendar: { tradeDate: "2027-01-20", tradeDeadlineDate: "2027-02-05", regularSeasonEndDate: "2027-04-15" },
      snapshot: { verdict: "Maybe", cbaStatus: "warning", valueDiff: 12_500_000, scaleDiff: 9_000_000, note: "ATL needs value", evaluatedAt: "2027-01-20T12:00:00.000Z" }
    }]
  }, new Map(), new Map());

  expect(imported.length === 1, "wrapped scenario payload should import one scenario");
  expect(imported[0].third?.team === "DAL", "third team should survive import");
  expect(imported[0].left.assets[0].kind === "pick", "synthetic embedded pick should survive without static pick map");
  expect(imported[0].left.assets[1].kind === "cash" && imported[0].left.assets[1].cashAmount === 2_500_000, "cash amount should normalize");
  expect(imported[0].calendar?.tradeDeadlineDate === "2027-02-05", "calendar should survive import");
  expect(imported[0].snapshot?.cbaStatus === "warning" && imported[0].snapshot.valueDiff === 12_500_000, "status snapshot should survive import");
  expect(imported[0].snapshot?.evaluatedAt === "2027-01-20T12:00:00.000Z", "status snapshot evaluated timestamp should survive import");
  expect(imported[0].userNote === "Check wing-defense hedge at the deadline", "user note should survive import");
  expect(imported[0].pinned === true, "pinned saved scenario state should survive import");
  expect(savedTradeScenarioSides(imported[0]).length === 3, "saved scenario side helper should include third teams");
  return "imports wrapped scenario payloads with synthetic picks, cash, third team, calendar, and status snapshot";
}

function importLegacySavedScenariosPayload(): string {
  const imported = normalizeSavedTradeScenarios({
    savedScenarios: [{
      name: "Legacy cash",
      left: { team: "BOS", assets: [{ kind: "cash", cashAmount: 500_000 }] },
      right: { team: "MIA", assets: [] }
    }]
  }, new Map(), new Map());
  expect(imported.length === 1, "legacy savedScenarios payload should import");
  expect(imported[0].name === "Legacy cash", "legacy scenario name should survive");
  expect(imported[0].id.startsWith("trade-import-"), "missing ids should be generated");
  return "imports legacy savedScenarios payloads";
}

function importRehydratesKnownPlayerFromMap(): string {
  const mappedPlayer = player(42, "Mapped Player", "ATL");
  const stalePlayer = player(42, "Stale Player", "OLD");
  const imported = normalizeSavedTradeScenarios([{
    left: { team: "ATL", assets: [{ kind: "player", id: "player-42", player: stalePlayer, toTeam: "BKN" }] },
    right: { team: "BKN", assets: [] }
  }], new Map([[42, mappedPlayer]]), new Map());

  expect(imported.length === 1, "player scenario should import");
  const asset = imported[0].left.assets[0];
  expect(asset.kind === "player" && asset.player?.player_name === "Mapped Player", "known player should rehydrate from current map");
  expect(asset.toTeam === "BKN", "player route destination should survive rehydration");
  return "rehydrates imported player assets from the current player map";
}

function importRehydratesKnownPicksFromTradeAssetIds(): string {
  const genericPick = pick("generic-pick-2029-r1-0", "2029 Unprotected 1st");
  const officialPick = pick("pick-2026-1-ATL", "#1 ATL");
  const imported = normalizeSavedTradeScenarios([{
    id: "minimal-picks",
    name: "Minimal pick ids",
    left: {
      team: "ATL",
      assets: [
        { kind: "pick", id: "pick-generic-pick-2029-r1-0-1782502189362-abcd", toTeam: "BKN" },
        { kind: "pick", id: "pick-pick-2026-1-ATL-1782502189362-ef01", toTeam: "BKN" }
      ]
    },
    right: { team: "BKN", assets: [] }
  }], new Map(), new Map([
    [genericPick.asset_id, genericPick],
    [officialPick.asset_id, officialPick]
  ]));

  expect(imported.length === 1, "minimal pick id scenario should import");
  expect(imported[0].left.assets.length === 2, "known pick ids should rehydrate instead of being dropped");
  expect(imported[0].left.assets[0].kind === "pick" && imported[0].left.assets[0].pick?.asset_id === "generic-pick-2029-r1-0", "generic generated pick id should match the current pick map");
  expect(imported[0].left.assets[1].kind === "pick" && imported[0].left.assets[1].pick?.asset_id === "pick-2026-1-ATL", "official pick id with pick prefix should match the current pick map");
  expect(imported[0].left.assets.every((asset) => asset.toTeam === "BKN"), "rehydrated pick destinations should survive import");
  return "rehydrates minimal imported pick assets from generated trade asset ids";
}

function importRejectsEmptyAndInvalidDeals(): string {
  const imported = normalizeSavedTradeScenarios({
    scenarios: [
      { left: { team: "ATL", assets: [] }, right: { team: "BKN", assets: [] } },
      { left: { team: "ATL", assets: [{ kind: "cash", cashAmount: -1 }] }, right: { team: "BKN", assets: [] } },
      { left: { team: "ATL", assets: [{ kind: "unknown", id: "bad" }] }, right: { team: "BKN", assets: [] } },
      { left: { assets: [{ kind: "cash", cashAmount: 1 }] }, right: { team: "BKN", assets: [] } }
    ]
  }, new Map(), new Map());
  expect(imported.length === 0, "empty and invalid deals should be rejected");
  return "rejects empty and invalid imported trade scenarios";
}

function savedScenarioSearchAndFilterBuckets(): string {
  const scenarios = normalizeSavedTradeScenarios({
    scenarios: [
      {
        id: "accepted",
        name: "Accepted player deal",
        userNote: "Keep if BKN asks for wing depth",
        pinned: true,
        left: { team: "ATL", assets: [{ kind: "player", id: "player-42", player: player(42, "Mapped Wing", "ATL"), toTeam: "BKN" }] },
        right: { team: "BKN", assets: [{ kind: "cash", cashAmount: 500_000, toTeam: "ATL" }] },
        snapshot: { verdict: "Accepted", cbaStatus: "legal", note: "Toss-up" }
      },
      {
        id: "review",
        name: "Review pick deal",
        left: { team: "DAL", assets: [{ kind: "pick", id: "pick-review", pick: pick("pick-review", "2030 protected first") }] },
        right: { team: "MIA", assets: [] },
        snapshot: { verdict: "Maybe", cbaStatus: "warning", note: "DAL needs value" }
      },
      {
        id: "declined",
        name: "Declined cash deal",
        left: { team: "BOS", assets: [{ kind: "cash", cashAmount: 1_500_000 }] },
        right: { team: "NYK", assets: [] },
        snapshot: { verdict: "Declined", cbaStatus: "illegal", note: "BOS says no" }
      },
      {
        id: "unevaluated",
        name: "Imported old deal",
        left: { team: "UTA", assets: [{ kind: "cash", cashAmount: 250_000 }] },
        right: { team: "SAS", assets: [] }
      }
    ]
  }, new Map(), new Map());
  const counts = savedTradeScenarioFilterCounts(scenarios);
  expect(counts.all === 4, "all bucket should count every scenario");
  expect(counts.pinned === 1, "pinned bucket should count pinned scenarios separately from status");
  expect(counts.accepted === 1 && counts.review === 1 && counts.declined === 1 && counts.unevaluated === 1, "status buckets should classify scenarios");
  expect(savedTradeScenarioFilterKey(scenarios[0]) === "accepted", "accepted scenario should classify as accepted");
  expect(savedTradeScenarioFilterKey(scenarios[1]) === "review", "warning/maybe scenario should classify as review");
  expect(savedTradeScenarioFilterKey(scenarios[2]) === "declined", "illegal/declined scenario should classify as declined");
  expect(savedTradeScenarioFilterKey(scenarios[3]) === "unevaluated", "missing snapshot should classify as unevaluated");
  expect(savedTradeScenarioMatchesQuery(scenarios[0], "mapped wing"), "search should match player names");
  expect(savedTradeScenarioMatchesQuery(scenarios[0], "wing depth"), "search should match user notes");
  expect(savedTradeScenarioMatchesQuery(scenarios[1], "needs value"), "search should match snapshot notes");
  expect(savedTradeScenarioMatchesQuery(scenarios[1], "2030 protected"), "search should match pick labels");
  expect(savedTradeScenarioMatchesQuery(scenarios[2], "cash"), "search should match cash assets");
  expect(savedTradeScenarioMatchesQuery(scenarios[3], "spurs", ["San Antonio Spurs"]), "search should match display-provided extra terms");
  expect(!savedTradeScenarioMatchesQuery(scenarios[0], "nonexistent"), "search should reject non-matching text");
  expect(savedTradeScenarioMatchesFilter(scenarios[0], "pinned"), "pinned filter should include pinned saved scenarios");
  expect(!savedTradeScenarioMatchesFilter(scenarios[1], "pinned"), "pinned filter should exclude unpinned saved scenarios");
  expect(savedTradeScenarioMatchesFilter(scenarios[0], "accepted"), "status filters should still match pinned scenarios by status");
  expect(savedTradeScenarioMatchesFilter(scenarios[2], "declined"), "declined filter should match declined scenarios");
  expect(savedTradeScenarioMatchesFilter(scenarios[3], "unevaluated"), "unevaluated filter should match missing snapshots");
  return "saved scenario search and filter buckets classify pinned, status, and persisted deal text";
}

function duplicateSavedScenarioBranchesWithUniqueName(): string {
  const [scenario] = normalizeSavedTradeScenarios([{
    id: "original",
    name: "Deadline swing",
    createdAt: "2027-01-01T00:00:00.000Z",
    left: { team: "ATL", assets: [{ kind: "pick", id: "pick-original", pick: pick("pick-original", "2031 first") }] },
    right: { team: "BKN", assets: [{ kind: "cash", cashAmount: 750_000 }] },
    calendar: { tradeDate: "2027-01-20", tradeDeadlineDate: "2027-02-05", regularSeasonEndDate: "2027-04-15" },
    userNote: "Duplicate should keep my context",
    snapshot: { verdict: "Maybe", cbaStatus: "warning", note: "ATL needs value" }
  }], new Map(), new Map());
  const duplicate = duplicateSavedTradeScenario(scenario, {
    id: "copy-id",
    createdAt: "2027-01-02T00:00:00.000Z",
    existingNames: ["Deadline swing", "Deadline swing copy"]
  });

  expect(duplicate.id === "copy-id", "duplicate should use provided id");
  expect(duplicate.name === "Deadline swing copy 2", "duplicate should choose the next available copy name");
  expect(duplicate.createdAt === "2027-01-02T00:00:00.000Z", "duplicate should use provided creation timestamp");
  expect(duplicate.snapshot?.note === scenario.snapshot?.note, "duplicate should preserve status snapshot");
  expect(duplicate.userNote === "Duplicate should keep my context", "duplicate should preserve user notes");
  expect(duplicate.calendar?.tradeDate === scenario.calendar?.tradeDate, "duplicate should preserve calendar");
  expect(duplicate.left.assets[0] !== scenario.left.assets[0], "duplicate should clone asset arrays");
  duplicate.left.assets[0].toTeam = "MIA";
  expect(scenario.left.assets[0].toTeam !== "MIA", "mutating duplicate assets should not mutate original");
  expect(savedTradeScenarioCopyName("Deadline swing", ["deadline swing", "Deadline swing copy"]) === "Deadline swing copy 2", "copy name helper should share duplicate naming rules");
  expect(savedTradeScenarioCopyName("   ", ["Scenario", "Scenario copy"]) === "Scenario copy 2", "copy name helper should fallback blank names to Scenario");
  return "duplicates saved scenarios as independent branches with unique copy names";
}

function savedScenarioSortingOrdersSavedDeals(): string {
  const scenarios = normalizeSavedTradeScenarios({
    scenarios: [
      {
        id: "accepted",
        name: "Beta accepted",
        createdAt: "2027-01-02T00:00:00.000Z",
        pinned: true,
        left: { team: "ATL", assets: [{ kind: "cash", cashAmount: 500_000 }] },
        right: { team: "BKN", assets: [] },
        snapshot: { verdict: "Accepted", cbaStatus: "legal", valueDiff: 1_000_000 }
      },
      {
        id: "declined",
        name: "Gamma declined",
        createdAt: "2027-01-03T00:00:00.000Z",
        left: { team: "BOS", assets: [{ kind: "cash", cashAmount: 1_000_000 }] },
        right: { team: "NYK", assets: [] },
        snapshot: { verdict: "Declined", cbaStatus: "illegal", valueDiff: 40_000_000 }
      },
      {
        id: "review",
        name: "Alpha review",
        createdAt: "2027-01-01T00:00:00.000Z",
        left: { team: "DAL", assets: [{ kind: "cash", cashAmount: 750_000 }] },
        right: { team: "MIA", assets: [] },
        snapshot: { verdict: "Maybe", cbaStatus: "warning", valueDiff: 20_000_000 }
      },
      {
        id: "old",
        name: "Delta old",
        createdAt: "2026-12-31T00:00:00.000Z",
        left: { team: "UTA", assets: [{ kind: "cash", cashAmount: 250_000 }] },
        right: { team: "SAS", assets: [] }
      }
    ]
  }, new Map(), new Map());

  expect(sortSavedTradeScenarios(scenarios, "newest").map((item) => item.id).join(",") === "accepted,declined,review,old", "newest sort should keep pinned deals first, then order by createdAt descending");
  expect(sortSavedTradeScenarios(scenarios, "value_diff").map((item) => item.id).join(",") === "accepted,declined,review,old", "value gap sort should keep pinned deals first, then put largest modeled gaps first");
  expect(sortSavedTradeScenarios(scenarios, "status").map((item) => item.id).join(",") === "accepted,declined,review,old", "status sort should keep pinned deals first, then prioritize declined, review, unevaluated, accepted");
  expect(sortSavedTradeScenarios(scenarios, "name").map((item) => item.id).join(",") === "accepted,review,old,declined", "name sort should keep pinned deals first, then order alphabetically");
  expect(savedTradeScenarioMatchesQuery(scenarios[0], "pinned"), "search should match pinned saved deals");
  return "saved scenario sorting keeps pinned deals first across newest, value gap, status, and name";
}

function pinnedScenarioRetentionProtectsPinnedDeals(): string {
  const scenarios = normalizeSavedTradeScenarios({
    scenarios: [
      scenarioPayload("new-save", "New save", "2027-01-20T00:00:00.000Z"),
      ...Array.from({ length: 12 }, (_, index) => scenarioPayload(`unpinned-${index}`, `Unpinned ${index}`, `2027-01-${String(19 - index).padStart(2, "0")}T00:00:00.000Z`)),
      scenarioPayload("pinned-old", "Pinned old", "2026-12-01T00:00:00.000Z", true)
    ]
  }, new Map(), new Map());
  const retained = retainSavedTradeScenarios(scenarios, 12);
  const retainedIds = retained.map((scenario) => scenario.id);

  expect(retained.length === 12, "retained list should honor the saved scenario limit");
  expect(retainedIds[0] === "pinned-old", "pinned saved deals should be promoted before retained unpinned deals");
  expect(retainedIds.includes("new-save"), "new unpinned saves should still be retained when room remains");
  expect(!retainedIds.includes("unpinned-11"), "old unpinned overflow should be trimmed before pinned overflow");

  const pinnedOnly = retainSavedTradeScenarios([
    scenarioPayload("pinned-oldest", "Pinned oldest", "2027-01-01T00:00:00.000Z", true),
    scenarioPayload("pinned-newest", "Pinned newest", "2027-01-03T00:00:00.000Z", true),
    scenarioPayload("pinned-middle", "Pinned middle", "2027-01-02T00:00:00.000Z", true)
  ].map((item) => normalizeSavedTradeScenarios([item], new Map(), new Map())[0]), 2);
  expect(pinnedOnly.map((scenario) => scenario.id).join(",") === "pinned-newest,pinned-middle", "when pins exceed the cap, newest pins should survive first");
  expect(retainSavedTradeScenarios(scenarios, 0).length === 0, "zero limit should retain no saved scenarios");
  return "pinned saved scenario retention protects pinned deals from list-cap overflow";
}

function restoreSavedScenarioReinstatesDeletedDeal(): string {
  const [deleted] = normalizeSavedTradeScenarios([scenarioPayload("deleted-id", "Restore me", "2027-01-03T00:00:00.000Z", true)], new Map(), new Map());
  const [sameName] = normalizeSavedTradeScenarios([scenarioPayload("same-name-id", "Restore me", "2027-01-04T00:00:00.000Z")], new Map(), new Map());
  const [sameId] = normalizeSavedTradeScenarios([scenarioPayload("deleted-id", "Renamed duplicate", "2027-01-05T00:00:00.000Z")], new Map(), new Map());
  const [other] = normalizeSavedTradeScenarios([scenarioPayload("other-id", "Other", "2027-01-02T00:00:00.000Z")], new Map(), new Map());
  const restored = restoreSavedTradeScenario([sameName, sameId, other], deleted, { limit: 12 });

  expect(restored.length === 2, "restoring a saved scenario should remove current duplicates by id or name");
  expect(restored[0].id === "deleted-id", "restored scenario should return to the front of the saved list");
  expect(restored[0].name === "Restore me", "restored scenario should keep the deleted scenario name");
  expect(restored[0].pinned === true, "restored scenario should preserve pinned metadata");
  expect(restored[1].id === "other-id", "unmatched saved scenarios should remain after restore");
  return "saved scenario restore reinstates deleted deals and dedupes by id or name";
}

function clearVisibleSavedScenariosProtectsPinnedDeals(): string {
  const scenarios = normalizeSavedTradeScenarios({
    scenarios: [
      scenarioPayload("visible-pinned", "Visible pinned", "2027-01-05T00:00:00.000Z", true),
      scenarioPayload("visible-unpinned", "Visible unpinned", "2027-01-04T00:00:00.000Z"),
      scenarioPayload("hidden", "Hidden", "2027-01-03T00:00:00.000Z")
    ]
  }, new Map(), new Map());
  const visible = scenarios.filter((scenario) => scenario.id !== "hidden");
  const protectedClear = clearVisibleSavedTradeScenarios(scenarios, visible);

  expect(protectedClear.deleted.length === 1 && protectedClear.deleted[0].id === "visible-unpinned", "bulk clear should protect visible pinned scenarios by default");
  expect(protectedClear.scenarios.map((scenario) => scenario.id).join(",") === "visible-pinned,hidden", "bulk clear should remove only clearable visible scenarios");

  const restored = restoreSavedTradeScenarios(protectedClear.scenarios, protectedClear.deleted);
  expect(restored.map((scenario) => scenario.id).join(",") === "visible-unpinned,visible-pinned,hidden", "restoring a cleared batch should return deleted scenarios to the front");

  const pinnedClear = clearVisibleSavedTradeScenarios(scenarios, [scenarios[0]], { includePinned: true });
  expect(pinnedClear.deleted.length === 1 && pinnedClear.deleted[0].id === "visible-pinned", "bulk clear should allow pinned deletion when explicitly requested");
  expect(!pinnedClear.scenarios.some((scenario) => scenario.id === "visible-pinned"), "explicit pinned clear should remove the pinned scenario");
  return "bulk saved scenario clear protects pinned deals unless pinned deletion is explicit";
}

function savedScenarioExportPayloadTracksVisibleScope(): string {
  const scenarios = normalizeSavedTradeScenarios({
    scenarios: [
      scenarioPayload("visible-pinned", "Visible pinned", "2027-01-03T00:00:00.000Z", true),
      scenarioPayload("hidden", "Hidden", "2027-01-02T00:00:00.000Z")
    ]
  }, new Map(), new Map());
  const visible = scenarios.filter((scenario) => savedTradeScenarioMatchesFilter(scenario, "pinned"));
  const payload = buildSavedTradeScenarioExportPayload(visible, {
    season: 2027,
    exportedAt: "2027-02-01T00:00:00.000Z",
    scope: { kind: "visible", filter: "pinned", query: "pinned", sort: "name" }
  });

  expect(payload.version === 1, "export payload should declare the saved scenario version");
  expect(payload.season === 2027, "export payload should include the export season");
  expect(payload.exportedAt === "2027-02-01T00:00:00.000Z", "export payload should use the provided timestamp");
  expect(payload.scope?.kind === "visible" && payload.scope.filter === "pinned" && payload.scope.query === "pinned" && payload.scope.sort === "name", "visible export payload should preserve filter, query, and sort scope");
  expect(payload.scenarios.length === 1 && payload.scenarios[0].id === "visible-pinned", "visible export payload should include only the selected visible scenarios");
  return "saved scenario export payload tracks visible scope and selected scenarios";
}

function savedScenarioUpdatePreservesPinnedMetadata(): string {
  const [existing] = normalizeSavedTradeScenarios([{
    ...scenarioPayload("original-id", "Pinned update", "2027-01-01T00:00:00.000Z", true),
    userNote: "Original rationale",
    snapshot: { verdict: "Maybe", cbaStatus: "warning", note: "Original note" }
  }], new Map(), new Map());
  const [replacement] = normalizeSavedTradeScenarios([{
    ...scenarioPayload("replacement-id", "Pinned update", "2027-01-05T00:00:00.000Z"),
    userNote: "Updated rationale",
    left: { team: "ATL", assets: [{ kind: "cash", cashAmount: 900_000 }] },
    snapshot: { verdict: "Accepted", cbaStatus: "legal", note: "Updated note" }
  }], new Map(), new Map());
  const [other] = normalizeSavedTradeScenarios([scenarioPayload("other-id", "Other", "2027-01-02T00:00:00.000Z")], new Map(), new Map());
  const updated = upsertSavedTradeScenario([existing, other], replacement);

  expect(updated.length === 2, "updating by saved scenario name should replace the existing row instead of duplicating it");
  expect(updated[0].id === "original-id", "updating by name should preserve the existing saved scenario id");
  expect(updated[0].pinned === true, "updating a pinned saved scenario should preserve the pin");
  expect(updated[0].createdAt === "2027-01-05T00:00:00.000Z", "updated saved scenario should use the new save timestamp");
  expect(updated[0].left.assets[0].kind === "cash" && updated[0].left.assets[0].cashAmount === 900_000, "updated saved scenario should use the new trade assets");
  expect(updated[0].userNote === "Updated rationale", "updated saved scenario should use the new user note");
  expect(updated[0].snapshot?.note === "Updated note", "updated saved scenario should use the new status snapshot");
  expect(updated[1].id === "other-id", "unmatched saved scenarios should remain after an update");

  const [loaded] = normalizeSavedTradeScenarios([{
    ...scenarioPayload("loaded-id", "Loaded deal", "2027-01-01T00:00:00.000Z", true),
    userNote: "Loaded original"
  }], new Map(), new Map());
  const [nameCollision] = normalizeSavedTradeScenarios([scenarioPayload("collision-id", "Renamed loaded", "2027-01-02T00:00:00.000Z")], new Map(), new Map());
  const [renamed] = normalizeSavedTradeScenarios([{
    ...scenarioPayload("loaded-id", "Renamed loaded", "2027-01-06T00:00:00.000Z"),
    userNote: "Renamed rationale"
  }], new Map(), new Map());
  const updatedById = upsertSavedTradeScenario([loaded, nameCollision, other], renamed, { match: "id" });
  expect(updatedById.length === 2, "updating a loaded scenario by id should remove any same-name collision");
  expect(updatedById[0].id === "loaded-id" && updatedById[0].name === "Renamed loaded", "updating by id should preserve the loaded saved scenario id while allowing rename");
  expect(updatedById[0].pinned === true, "updating by id should preserve pinned metadata");
  expect(updatedById[0].userNote === "Renamed rationale", "updating by id should use the renamed scenario note");
  expect(!updatedById.some((scenario) => scenario.id === "collision-id"), "updating by id should dedupe against the renamed scenario name");
  return "saved scenario updates preserve pinned metadata while replacing deal content by name or loaded id";
}

function importedScenarioMergePreservesLocalMetadata(): string {
  const [localPinned] = normalizeSavedTradeScenarios([{
    ...scenarioPayload("local-id", "Same Name", "2027-01-01T00:00:00.000Z", true),
    userNote: "Local rationale",
    snapshot: { verdict: "Maybe", cbaStatus: "warning", note: "Local note" }
  }], new Map(), new Map());
  const [localOther] = normalizeSavedTradeScenarios([scenarioPayload("local-other", "Local other", "2027-01-02T00:00:00.000Z")], new Map(), new Map());
  const imported = normalizeSavedTradeScenarios([{
    ...scenarioPayload("import-id", "same name", "2027-01-04T00:00:00.000Z"),
    userNote: "Imported rationale",
    left: { team: "ATL", assets: [{ kind: "cash", cashAmount: 1_100_000 }] },
    snapshot: { verdict: "Accepted", cbaStatus: "legal", note: "Imported update" }
  }, scenarioPayload("brand-new", "Brand new", "2027-01-03T00:00:00.000Z")], new Map(), new Map());
  const result = mergeImportedSavedTradeScenarioResult([localPinned, localOther], imported);
  const merged = result.scenarios;

  expect(result.added === 1 && result.updated === 1, "import merge result should report added and updated scenario counts");
  expect(merged.length === 3, "import merge should update matching local rows without dropping unrelated saved scenarios");
  expect(merged[0].id === "local-id", "same-name imported scenarios should preserve the local saved id");
  expect(merged[0].pinned === true, "same-name imported scenarios should preserve local pinned metadata");
  expect(merged[0].name === "same name", "same-name imported scenarios should use imported deal content");
  expect(merged[0].left.assets[0].kind === "cash" && merged[0].left.assets[0].cashAmount === 1_100_000, "same-name imported scenarios should replace trade assets");
  expect(merged[0].userNote === "Imported rationale", "same-name imported scenarios should replace user notes");
  expect(merged[0].snapshot?.note === "Imported update", "same-name imported scenarios should replace snapshot content");
  expect(merged[1].id === "brand-new", "new imported scenarios should remain ahead of existing unmatched rows");
  expect(merged[2].id === "local-other", "unmatched local scenarios should remain after imported scenarios");
  expect(new Set(merged.map((scenario) => scenario.name.trim().toLowerCase())).size === merged.length, "import merge should not leave duplicate scenario names");
  return "imported scenario merge preserves local pin/id metadata while deduping by name";
}

function savedScenarioViewDefaultDetectionTracksFilterQueryAndSort(): string {
  expect(savedTradeScenarioViewIsDefault("all", "", "newest"), "default saved view should be recognized");
  expect(savedTradeScenarioViewIsDefault("all", "   ", "newest"), "blank search should still count as the default saved view");
  expect(!savedTradeScenarioViewIsDefault("pinned", "", "newest"), "non-default saved filter should count as a custom view");
  expect(!savedTradeScenarioViewIsDefault("all", "hawks", "newest"), "non-empty saved search should count as a custom view");
  expect(!savedTradeScenarioViewIsDefault("all", "", "name"), "non-default saved sort should count as a custom view");
  return "saved scenario view default detection tracks filter, query, and sort state";
}

function savedScenarioViewSummaryLabelsVisibleCounts(): string {
  expect(savedTradeScenarioViewSummary(0, 0, "all", "", "newest") === "No saved deals", "empty saved view summary should handle no saved deals");
  expect(savedTradeScenarioViewSummary(1, 1, "all", "", "newest") === "1 saved deal", "default saved view summary should singularize one deal");
  expect(savedTradeScenarioViewSummary(2, 2, "all", "", "newest") === "2 saved deals", "default saved view summary should show total saved deals");
  expect(savedTradeScenarioViewSummary(1, 3, "pinned", "", "newest") === "Showing 1 of 3 saved deals", "filtered saved view summary should show visible and total counts");
  expect(savedTradeScenarioViewSummary(3, 3, "all", "", "name") === "Showing all 3 saved deals", "custom sort summary should show all saved deals remain visible");
  expect(savedTradeScenarioViewSummary(0, 3, "accepted", "hawks", "name") === "Showing 0 of 3 saved deals", "empty custom saved view summary should still show total context");
  return "saved scenario view summary labels default, custom, and empty visible counts";
}

function scenarioPayload(id: string, name: string, createdAt: string, pinned = false): Record<string, unknown> {
  return {
    id,
    name,
    createdAt,
    pinned,
    left: { team: "ATL", assets: [{ kind: "cash", cashAmount: 500_000 }] },
    right: { team: "BKN", assets: [] }
  };
}

function pick(assetId: string, label: string): PickAsset {
  return {
    asset_id: assetId,
    label,
    pick: 15,
    round: 1,
    normalized: 0.5,
    value: 20_000_000,
    asset_type: "generic_pick",
    draft_year: 2029,
    protection: "unprotected",
    protection_cutoff: 0
  };
}

function player(nbaId: number, playerName: string, team: string): PlayerImpact {
  return {
    nba_id: nbaId,
    player_name: playerName,
    year: 2027,
    team,
    position: "SF",
    Minutes: 1200,
    off_dep: 0,
    def_dep: 0,
    offense: 0,
    defense: 0,
    total: 0,
    score: 0,
    tier: "Regression",
    timin: 0,
    value: 0,
    trade_value: 0,
    fa_value: 0,
    scalability: 1,
    projection_y1: 0,
    projection_y2: 0,
    projection_y3: 0,
    projection_y4: 0,
    contract: 10_000_000,
    contract_status: "Signed"
  };
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
