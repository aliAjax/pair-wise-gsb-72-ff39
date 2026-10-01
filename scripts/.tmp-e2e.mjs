var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/services/database.ts
var database_exports = {};
__export(database_exports, {
  BATCH_FAILURE_KEY: () => BATCH_FAILURE_KEY,
  applyReview: () => applyReview,
  buildHomeState: () => buildHomeState,
  clone: () => clone,
  getDashboardStats: () => getDashboardStats,
  getEnvironmentState: () => getEnvironmentState,
  readDatabase: () => readDatabase,
  rollbackFlag: () => rollbackFlag,
  seedDatabase: () => seedDatabase,
  syncHomeState: () => syncHomeState,
  toCandidateSnapshot: () => toCandidateSnapshot,
  writeDatabase: () => writeDatabase
});
var STORAGE_KEY, BATCH_FAILURE_KEY, clone, ENVIRONMENT_ORDER, buildHomeState, emptyEnvironmentState, getEnvironmentState, syncHomeState, toCandidateSnapshot, migrateDatabase, flags, issues, audit, seedDatabase, readDatabase, writeDatabase, applyReview, rollbackFlag, getDashboardStats;
var init_database = __esm({
  "src/services/database.ts"() {
    STORAGE_KEY = "feature-flag-release-console-v1";
    BATCH_FAILURE_KEY = "feature-flag-release-batch-fail-next";
    clone = (value) => JSON.parse(JSON.stringify(value));
    ENVIRONMENT_ORDER = ["dev", "staging", "production"];
    buildHomeState = (flag) => ({
      environment: flag.environment,
      status: flag.status,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      audienceRules: clone(flag.audienceRules),
      dependencies: clone(flag.dependencies),
      rolloutSteps: clone(flag.rolloutSteps),
      minClientVersion: flag.minClientVersion[flag.environment],
      updatedAt: flag.updatedAt
    });
    emptyEnvironmentState = (environment, minClientVersion) => ({
      environment,
      status: "draft",
      enabled: false,
      rolloutPercentage: 0,
      audienceRules: [],
      dependencies: [],
      rolloutSteps: [],
      minClientVersion,
      updatedAt: "2026-09-01T00:00:00+08:00"
    });
    getEnvironmentState = (flag, environment) => flag.environmentStates[environment] ?? emptyEnvironmentState(environment, flag.minClientVersion[environment]);
    syncHomeState = (flag) => {
      flag.environmentStates[flag.environment] = buildHomeState(flag);
      ENVIRONMENT_ORDER.forEach((environment) => {
        const state = flag.environmentStates[environment];
        if (state) state.minClientVersion = flag.minClientVersion[environment];
      });
    };
    toCandidateSnapshot = (state) => ({
      audienceRules: clone(state.audienceRules),
      dependencies: clone(state.dependencies),
      minClientVersion: state.minClientVersion,
      rolloutPercentage: state.rolloutPercentage,
      rolloutSteps: clone(state.rolloutSteps)
    });
    migrateDatabase = (database) => {
      if (!Array.isArray(database.batches)) database.batches = [];
      database.flags.forEach((flag) => {
        if (!flag.environmentStates) flag.environmentStates = {};
        if (!flag.environmentStates[flag.environment]) {
          flag.environmentStates[flag.environment] = buildHomeState(flag);
        }
        if (!flag.environmentStates.production && (flag.id === "flag-101" || flag.id === "flag-103")) {
          flag.environmentStates.production = {
            ...emptyEnvironmentState("production", flag.minClientVersion.production),
            audienceRules: clone(
              flag.id === "flag-101" ? [
                {
                  id: "r-101-legacy",
                  attribute: "client.web",
                  operator: "equals",
                  value: "true",
                  negate: false
                }
              ] : flag.audienceRules
            ),
            dependencies: []
          };
        }
      });
      return database;
    };
    flags = [
      {
        id: "flag-101",
        key: "checkout.express-pay-v2",
        name: "\u6781\u901F\u652F\u4ED8\u6D41\u7A0B V2",
        description: "\u5728\u7ED3\u7B97\u9875\u542F\u7528\u65B0\u7684\u5730\u5740\u786E\u8BA4\u548C\u652F\u4ED8\u805A\u5408\u6D41\u7A0B\u3002",
        owner: "\u9648\u601D\u8FDC",
        team: "\u4EA4\u6613\u4F53\u9A8C",
        status: "review",
        environment: "staging",
        enabled: false,
        rolloutPercentage: 20,
        audienceRules: [
          { id: "r-101-1", attribute: "user.tier", operator: "in", value: "gold,platinum", negate: false },
          { id: "r-101-2", attribute: "client.platform", operator: "equals", value: "ios", negate: false },
          { id: "r-101-3", attribute: "account.risk_score", operator: "lte", value: "40", negate: false }
        ],
        regions: ["CN-EAST", "CN-SOUTH"],
        minClientVersion: { dev: "8.18.0", staging: "8.18.0", production: "8.18.0" },
        dependencies: [
          { flagId: "flag-104", type: "requires", condition: "\u652F\u4ED8\u805A\u5408\u670D\u52A1\u5DF2\u542F\u7528" },
          { flagId: "flag-108", type: "conflicts", condition: "\u65E7\u7248\u4F18\u60E0\u5238\u6D6E\u5C42\u4E0D\u53EF\u540C\u65F6\u542F\u7528" }
        ],
        rollbackConditions: ["\u652F\u4ED8\u6210\u529F\u7387 5 \u5206\u949F\u4F4E\u4E8E 96%", "P95 \u5EF6\u8FDF\u9AD8\u4E8E 2200ms", "\u9519\u8BEF\u7387\u9AD8\u4E8E 1.2%"],
        metricNames: ["checkout_payment_success_rate", "checkout_p95_latency"],
        deadCodeStatus: "candidate",
        rolloutSteps: [
          { id: "s-1", percentage: 1, audience: "\u5185\u90E8\u4F53\u9A8C\u8D26\u53F7", startedAt: "2026-09-25T10:00:00+08:00", status: "completed", guardrails: ["\u65E0\u963B\u65AD\u9519\u8BEF"] },
          { id: "s-2", percentage: 5, audience: "\u534E\u4E1C\u533A\u91D1\u5361\u7528\u6237", startedAt: "2026-09-27T14:30:00+08:00", status: "completed", guardrails: ["\u652F\u4ED8\u6210\u529F\u7387 > 97%"] },
          { id: "s-3", percentage: 20, audience: "iOS \u91D1\u5361\u53CA\u94C2\u91D1\u7528\u6237", startedAt: "2026-09-29T09:00:00+08:00", status: "running", guardrails: ["\u9519\u8BEF\u7387 < 1.2%", "P95 < 2200ms"] },
          { id: "s-4", percentage: 50, audience: "\u5168\u91CF\u9AD8\u4EF7\u503C\u7528\u6237", startedAt: "2026-10-02T10:00:00+08:00", status: "planned", guardrails: ["\u4EBA\u5DE5\u5BA1\u6279"] }
        ],
        environmentStates: {
          dev: {
            environment: "dev",
            status: "active",
            enabled: true,
            rolloutPercentage: 100,
            audienceRules: [
              { id: "r-101-dev-1", attribute: "user.tier", operator: "in", value: "gold,platinum", negate: false },
              { id: "r-101-dev-2", attribute: "client.platform", operator: "equals", value: "ios", negate: false },
              { id: "r-101-dev-3", attribute: "account.risk_score", operator: "lte", value: "40", negate: false }
            ],
            dependencies: [
              { flagId: "flag-104", type: "requires", condition: "\u652F\u4ED8\u805A\u5408\u670D\u52A1\u5DF2\u542F\u7528" },
              { flagId: "flag-108", type: "conflicts", condition: "\u65E7\u7248\u4F18\u60E0\u5238\u6D6E\u5C42\u4E0D\u53EF\u540C\u65F6\u542F\u7528" }
            ],
            rolloutSteps: [
              { id: "s-dev-101", percentage: 100, audience: "\u5168\u90E8\u5F00\u53D1\u8054\u8C03\u6D41\u91CF", startedAt: "2026-09-20T10:00:00+08:00", status: "completed", guardrails: ["\u8054\u8C03\u73AF\u5883\u65E0\u963B\u65AD\u9519\u8BEF"] }
            ],
            minClientVersion: "8.18.0",
            updatedAt: "2026-09-24T11:00:00+08:00"
          }
        },
        createdAt: "2026-09-12T14:20:00+08:00",
        updatedAt: "2026-09-29T09:05:00+08:00",
        lastChangedBy: "\u9648\u601D\u8FDC"
      },
      {
        id: "flag-102",
        key: "catalog.smart-recommendation",
        name: "\u5546\u54C1\u667A\u80FD\u63A8\u8350\u4F4D",
        description: "\u57FA\u4E8E\u5B9E\u65F6\u610F\u56FE\u5728\u5546\u54C1\u5217\u8868\u63D2\u5165\u63A8\u8350\u6A21\u5757\u3002",
        owner: "\u8BB8\u8587",
        team: "\u589E\u957F\u7B97\u6CD5",
        status: "active",
        environment: "production",
        enabled: true,
        rolloutPercentage: 35,
        audienceRules: [
          { id: "r-102-1", attribute: "app.version", operator: "gte", value: "9.2.0", negate: false },
          { id: "r-102-2", attribute: "user.segment", operator: "in", value: "active,high_intent", negate: false }
        ],
        regions: ["CN-EAST", "CN-NORTH", "CN-SOUTH"],
        minClientVersion: { dev: "9.1.0", staging: "9.2.0", production: "9.2.0" },
        dependencies: [{ flagId: "flag-105", type: "requires", condition: "\u7279\u5F81\u670D\u52A1\u5EF6\u8FDF\u7A33\u5B9A\u5728 80ms \u5185" }],
        rollbackConditions: ["\u63A8\u8350\u6A21\u5757\u70B9\u51FB\u7387\u4E0B\u964D 15%", "\u63A5\u53E3\u8D85\u65F6\u7387\u9AD8\u4E8E 2%"],
        metricNames: ["recommend_ctr", "feature_service_timeout_rate"],
        deadCodeStatus: "clean",
        rolloutSteps: [
          { id: "s-201", percentage: 10, audience: "\u6D3B\u8DC3\u7528\u6237", startedAt: "2026-09-20T10:00:00+08:00", status: "completed", guardrails: ["CTR \u4E0D\u4F4E\u4E8E\u5BF9\u7167 5%"] },
          { id: "s-202", percentage: 35, audience: "\u6D3B\u8DC3\u53CA\u9AD8\u610F\u56FE\u7528\u6237", startedAt: "2026-09-27T10:00:00+08:00", status: "running", guardrails: ["\u63A5\u53E3\u8D85\u65F6\u7387 < 2%"] }
        ],
        environmentStates: {},
        createdAt: "2026-08-28T09:30:00+08:00",
        updatedAt: "2026-09-28T16:40:00+08:00",
        lastChangedBy: "\u5468\u542F"
      },
      {
        id: "flag-103",
        key: "console.billing-export-v3",
        name: "\u8D26\u5355\u5F02\u6B65\u5BFC\u51FA V3",
        description: "\u628A\u5927\u8D26\u5355\u5BFC\u51FA\u5207\u6362\u81F3\u5F02\u6B65\u4EFB\u52A1\u548C\u5BF9\u8C61\u5B58\u50A8\u4E0B\u8F7D\u3002",
        owner: "\u5468\u822A",
        team: "\u4E91\u63A7\u5236\u53F0",
        status: "review",
        environment: "dev",
        enabled: false,
        rolloutPercentage: 0,
        audienceRules: [
          { id: "r-103-1", attribute: "account.type", operator: "equals", value: "enterprise", negate: false }
        ],
        regions: ["CN-EAST"],
        minClientVersion: { dev: "5.10.0", staging: "5.10.0", production: "5.10.0" },
        dependencies: [{ flagId: "flag-107", type: "requires", condition: "\u5F02\u6B65\u4EFB\u52A1\u961F\u5217\u5BB9\u91CF\u5DF2\u6269\u5BB9" }],
        rollbackConditions: ["\u4EFB\u52A1\u5931\u8D25\u7387\u9AD8\u4E8E 3%", "\u5BFC\u51FA\u6587\u4EF6\u8D85\u8FC7 24 \u5C0F\u65F6\u672A\u751F\u6210"],
        metricNames: [],
        deadCodeStatus: "candidate",
        rolloutSteps: [
          { id: "s-301", percentage: 5, audience: "\u5185\u90E8\u6D4B\u8BD5\u4F01\u4E1A", startedAt: "2026-10-08T10:00:00+08:00", status: "planned", guardrails: ["\u4EFB\u52A1\u6210\u529F\u7387 > 98%"] }
        ],
        environmentStates: {},
        createdAt: "2026-09-18T11:10:00+08:00",
        updatedAt: "2026-09-28T18:20:00+08:00",
        lastChangedBy: "\u5468\u822A"
      },
      {
        id: "flag-104",
        key: "payment.aggregate-router",
        name: "\u652F\u4ED8\u805A\u5408\u8DEF\u7531",
        description: "\u7EDF\u4E00\u6536\u5355\u6E20\u9053\u548C\u652F\u4ED8\u964D\u7EA7\u7B56\u7565\u3002",
        owner: "\u97E9\u79CB",
        team: "\u652F\u4ED8\u5E73\u53F0",
        status: "active",
        environment: "production",
        enabled: true,
        rolloutPercentage: 100,
        audienceRules: [],
        regions: ["CN-EAST", "CN-NORTH", "CN-SOUTH", "CN-WEST"],
        minClientVersion: { dev: "8.12.0", staging: "8.12.0", production: "8.12.0" },
        dependencies: [],
        rollbackConditions: ["\u4EFB\u4E00\u6536\u5355\u6E20\u9053\u8FDE\u7EED\u5931\u8D25 20 \u6B21"],
        metricNames: ["payment_router_error_rate"],
        deadCodeStatus: "clean",
        rolloutSteps: [{ id: "s-401", percentage: 100, audience: "\u5168\u90E8\u7528\u6237", startedAt: "2026-07-01T00:00:00+08:00", status: "completed", guardrails: [] }],
        environmentStates: {},
        createdAt: "2026-06-12T10:00:00+08:00",
        updatedAt: "2026-09-25T12:30:00+08:00",
        lastChangedBy: "\u97E9\u79CB"
      },
      {
        id: "flag-105",
        key: "feature.realtime-profile",
        name: "\u5B9E\u65F6\u7528\u6237\u7279\u5F81\u670D\u52A1",
        description: "\u5411\u63A8\u8350\u548C\u641C\u7D22\u6A21\u5757\u63D0\u4F9B\u5B9E\u65F6\u753B\u50CF\u7279\u5F81\u3002",
        owner: "\u90ED\u5B81",
        team: "\u6570\u636E\u5E73\u53F0",
        status: "frozen",
        environment: "production",
        enabled: true,
        rolloutPercentage: 60,
        audienceRules: [],
        regions: ["CN-EAST", "CN-SOUTH"],
        minClientVersion: { dev: "1.0.0", staging: "1.0.0", production: "1.0.0" },
        dependencies: [],
        rollbackConditions: ["P99 \u5EF6\u8FDF\u9AD8\u4E8E 350ms"],
        metricNames: ["feature_service_latency", "feature_cache_hit_rate"],
        deadCodeStatus: "clean",
        rolloutSteps: [{ id: "s-501", percentage: 60, audience: "\u63A8\u8350\u670D\u52A1\u6D41\u91CF", startedAt: "2026-09-28T09:00:00+08:00", status: "paused", guardrails: ["\u89C2\u5BDF\u7F13\u5B58\u547D\u4E2D\u7387"] }],
        environmentStates: {},
        createdAt: "2026-05-18T13:40:00+08:00",
        updatedAt: "2026-09-29T08:50:00+08:00",
        lastChangedBy: "\u90ED\u5B81"
      },
      {
        id: "flag-106",
        key: "campaign.new-editor",
        name: "\u6D3B\u52A8\u914D\u7F6E\u65B0\u7248\u7F16\u8F91\u5668",
        description: "\u63D0\u4F9B\u62D6\u62FD\u5F0F\u6D3B\u52A8\u9875\u9762\u914D\u7F6E\u80FD\u529B\u3002",
        owner: "\u6881\u742A",
        team: "\u589E\u957F\u8FD0\u8425",
        status: "rolled-back",
        environment: "production",
        enabled: false,
        rolloutPercentage: 0,
        audienceRules: [{ id: "r-106-1", attribute: "operator.role", operator: "equals", value: "campaign_admin", negate: false }],
        regions: ["CN-EAST"],
        minClientVersion: { dev: "2.6.0", staging: "2.6.0", production: "2.6.0" },
        dependencies: [],
        rollbackConditions: ["\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25\u7387\u9AD8\u4E8E 2%"],
        metricNames: ["campaign_editor_save_success"],
        deadCodeStatus: "confirmed",
        rolloutSteps: [{ id: "s-601", percentage: 20, audience: "\u534E\u4E1C\u8FD0\u8425\u56E2\u961F", startedAt: "2026-09-27T14:00:00+08:00", status: "paused", guardrails: [] }],
        environmentStates: {},
        createdAt: "2026-08-20T10:15:00+08:00",
        updatedAt: "2026-09-28T15:48:00+08:00",
        lastChangedBy: "\u6881\u742A"
      },
      {
        id: "flag-107",
        key: "infra.async-task-queue-v2",
        name: "\u5F02\u6B65\u4EFB\u52A1\u961F\u5217 V2",
        description: "\u8FC1\u79FB\u957F\u4EFB\u52A1\u81F3\u9AD8\u541E\u5410\u961F\u5217\u3002",
        owner: "\u8D75\u5C9A",
        team: "\u57FA\u7840\u67B6\u6784",
        status: "active",
        environment: "staging",
        enabled: true,
        rolloutPercentage: 100,
        audienceRules: [],
        regions: ["CN-EAST"],
        minClientVersion: { dev: "1.0.0", staging: "1.0.0", production: "1.0.0" },
        dependencies: [],
        rollbackConditions: ["\u961F\u5217\u79EF\u538B\u8D85\u8FC7 10 \u4E07"],
        metricNames: ["queue_backlog", "task_failure_rate"],
        deadCodeStatus: "clean",
        rolloutSteps: [{ id: "s-701", percentage: 100, audience: "\u9884\u53D1\u957F\u4EFB\u52A1", startedAt: "2026-09-22T09:00:00+08:00", status: "completed", guardrails: [] }],
        environmentStates: {},
        createdAt: "2026-08-10T16:20:00+08:00",
        updatedAt: "2026-09-27T11:12:00+08:00",
        lastChangedBy: "\u8D75\u5C9A"
      },
      {
        id: "flag-108",
        key: "checkout.legacy-coupon-overlay",
        name: "\u65E7\u7248\u4F18\u60E0\u5238\u6D6E\u5C42",
        description: "\u7ED3\u7B97\u9875\u65E7\u4F18\u60E0\u5238\u9009\u62E9\u6D6E\u5C42\uFF0C\u8BA1\u5212\u4E0B\u7248\u672C\u4E0B\u7EBF\u3002",
        owner: "\u6C88\u5B81",
        team: "\u4EA4\u6613\u4F53\u9A8C",
        status: "frozen",
        environment: "production",
        enabled: true,
        rolloutPercentage: 12,
        audienceRules: [{ id: "r-108-1", attribute: "app.version", operator: "lte", value: "8.17.9", negate: false }],
        regions: ["CN-EAST", "CN-NORTH", "CN-SOUTH"],
        minClientVersion: { dev: "8.10.0", staging: "8.10.0", production: "8.10.0" },
        dependencies: [{ flagId: "flag-101", type: "conflicts", condition: "\u65B0\u7248\u652F\u4ED8\u6D41\u7A0B\u4E0D\u53EF\u540C\u65F6\u542F\u7528" }],
        rollbackConditions: ["\u4F18\u60E0\u5238\u4F7F\u7528\u7387\u4E0B\u964D 10%"],
        metricNames: ["coupon_apply_success_rate"],
        deadCodeStatus: "confirmed",
        rolloutSteps: [{ id: "s-801", percentage: 12, audience: "\u4F4E\u7248\u672C\u5BA2\u6237\u7AEF", startedAt: "2026-09-20T09:00:00+08:00", status: "paused", guardrails: [] }],
        environmentStates: {},
        createdAt: "2025-12-10T09:00:00+08:00",
        updatedAt: "2026-09-29T09:10:00+08:00",
        lastChangedBy: "\u6C88\u5B81"
      }
    ];
    issues = [
      {
        id: "issue-1",
        flagId: "flag-101",
        flagKey: "checkout.express-pay-v2",
        category: "overlap",
        severity: "blocker",
        title: "\u4E0E\u65E7\u7248\u4F18\u60E0\u5238\u5B9E\u9A8C\u7EC4\u91CD\u53E0",
        detail: "20% \u7070\u5EA6\u4EBA\u7FA4\u4E2D\u6709 3.8% \u540C\u65F6\u547D\u4E2D checkout.legacy-coupon-overlay\u3002",
        suggestion: "\u5C06 risk_score <= 40 \u4E0E\u65E7\u7248\u6D6E\u5C42\u5B9E\u9A8C\u6392\u9664\u6761\u4EF6\u5408\u5E76\uFF0C\u6216\u5148\u5C06\u65E7\u5F00\u5173\u7070\u5EA6\u964D\u81F3 0\u3002",
        resolved: false
      },
      {
        id: "issue-2",
        flagId: "flag-101",
        flagKey: "checkout.express-pay-v2",
        category: "client-compatibility",
        severity: "warning",
        title: "\u4F4E\u7248\u672C\u5BA2\u6237\u7AEF\u7F3A\u5C11\u805A\u5408\u652F\u4ED8\u80FD\u529B",
        detail: "iOS 8.17.x \u7528\u6237\u4ECD\u4F1A\u547D\u4E2D\u65B0\u6D41\u7A0B\uFF0C\u4F46\u5BA2\u6237\u7AEF\u672A\u6CE8\u518C pay.aggregate.v2\u3002",
        suggestion: "\u628A app.version >= 8.18.0 \u52A0\u5165\u53D7\u4F17\u524D\u7F6E\u6761\u4EF6\u3002",
        resolved: false
      },
      {
        id: "issue-3",
        flagId: "flag-103",
        flagKey: "console.billing-export-v3",
        category: "missing-metric",
        severity: "blocker",
        title: "\u7F3A\u5C11\u4E0B\u8F7D\u5B8C\u6210\u7387\u76D1\u63A7",
        detail: "\u5F53\u524D\u4EC5\u914D\u7F6E\u4EFB\u52A1\u521B\u5EFA\u6307\u6807\uFF0C\u65E0\u6CD5\u81EA\u52A8\u89E6\u53D1\u5BFC\u51FA\u6587\u4EF6\u751F\u6210\u5931\u8D25\u56DE\u6EDA\u3002",
        suggestion: "\u63A5\u5165 billing_export_download_success_rate \u5E76\u914D\u7F6E 15 \u5206\u949F\u7A97\u53E3\u3002",
        resolved: false
      },
      {
        id: "issue-4",
        flagId: "flag-103",
        flagKey: "console.billing-export-v3",
        category: "dead-code",
        severity: "warning",
        title: "\u65E7\u540C\u6B65\u5BFC\u51FA\u5165\u53E3\u4ECD\u53EF\u8FBE",
        detail: "\u4EE3\u7801\u626B\u63CF\u53D1\u73B0 feature.billing_export_sync \u5206\u652F\u4ECD\u88AB\u8DEF\u7531\u5F15\u7528\u3002",
        suggestion: "\u63D0\u4F9B\u65E7\u5165\u53E3\u4E0B\u7EBF\u4EFB\u52A1\uFF0C\u5E76\u5728\u65B0\u5F00\u5173\u5168\u91CF\u540E\u79FB\u9664\u5206\u652F\u3002",
        resolved: false
      },
      {
        id: "issue-5",
        flagId: "flag-106",
        flagKey: "campaign.new-editor",
        category: "rule-conflict",
        severity: "warning",
        title: "\u4FDD\u5B58\u6743\u9650\u4E2D\u5B58\u5728\u4E92\u65A5\u89D2\u8272\u6761\u4EF6",
        detail: "\u89D2\u8272 equals campaign_admin \u4E0E\u540E\u7EED not-equals \u4E34\u65F6\u5BA1\u6838\u5458\u89C4\u5219\u540C\u65F6\u5B58\u5728\u3002",
        suggestion: "\u5408\u5E76\u4E3A\u660E\u786E\u7684\u767D\u540D\u5355\uFF0C\u907F\u514D\u89C4\u5219\u6C42\u503C\u987A\u5E8F\u53D8\u5316\u3002",
        resolved: true
      },
      {
        id: "issue-6",
        flagId: "flag-108",
        flagKey: "checkout.legacy-coupon-overlay",
        category: "dead-code",
        severity: "info",
        title: "\u5F00\u5173\u5DF2\u8FDB\u5165\u4E0B\u7EBF\u5019\u9009",
        detail: "\u6700\u8FD1 30 \u5929\u6CA1\u6709\u65B0\u589E\u4EE3\u7801\u5F15\u7528\uFF0C\u4EC5\u4FDD\u7559\u65E7\u5BA2\u6237\u7AEF\u517C\u5BB9\u5206\u652F\u3002",
        suggestion: "\u5728\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C\u8FBE\u5230 8.18.0 \u540E\u5B89\u6392\u4EE3\u7801\u6E05\u7406\u3002",
        resolved: false
      }
    ];
    audit = [
      {
        id: "audit-1",
        flagId: "flag-101",
        flagKey: "checkout.express-pay-v2",
        action: "rollout-adjusted",
        actor: "\u9648\u601D\u8FDC",
        summary: "\u7070\u5EA6\u6BD4\u4F8B\u7531 5% \u8C03\u6574\u81F3 20%\uFF0C\u4EC5\u8986\u76D6 iOS \u91D1\u5361\u53CA\u94C2\u91D1\u7528\u6237\u3002",
        before: "5%",
        after: "20%",
        affectedUsers: 48620,
        createdAt: "2026-09-29T09:05:00+08:00"
      },
      {
        id: "audit-2",
        flagId: "flag-105",
        flagKey: "feature.realtime-profile",
        action: "frozen",
        actor: "\u90ED\u5B81",
        summary: "P99 \u5EF6\u8FDF\u5347\u9AD8\uFF0C\u51BB\u7ED3\u914D\u7F6E\u5E76\u6682\u505C\u6269\u5927\u6D41\u91CF\u3002",
        before: "active",
        after: "frozen",
        affectedUsers: 12e5,
        createdAt: "2026-09-29T08:50:00+08:00"
      },
      {
        id: "audit-3",
        flagId: "flag-106",
        flagKey: "campaign.new-editor",
        action: "rolled-back",
        actor: "\u6881\u742A",
        summary: "\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25\u7387\u89E6\u53D1\u81EA\u52A8\u56DE\u6EDA\u6761\u4EF6\u3002",
        before: "20%",
        after: "0%",
        affectedUsers: 638,
        createdAt: "2026-09-28T15:48:00+08:00"
      },
      {
        id: "audit-4",
        flagId: "flag-102",
        flagKey: "catalog.smart-recommendation",
        action: "rollout-adjusted",
        actor: "\u5468\u542F",
        summary: "\u7070\u5EA6\u6269\u5927\u5230 35%\uFF0C\u63A8\u8350\u63A5\u53E3\u9519\u8BEF\u7387\u4FDD\u6301\u4F4E\u4E8E\u9608\u503C\u3002",
        before: "20%",
        after: "35%",
        affectedUsers: 812430,
        createdAt: "2026-09-28T16:40:00+08:00"
      },
      {
        id: "audit-5",
        flagId: "flag-103",
        flagKey: "console.billing-export-v3",
        action: "submitted",
        actor: "\u5468\u822A",
        summary: "\u63D0\u4EA4\u53D1\u5E03\u8BC4\u5BA1\uFF0C\u7B49\u5F85\u8865\u9F50\u5BFC\u51FA\u5B8C\u6210\u7387\u76D1\u63A7\u3002",
        before: "draft",
        after: "draft",
        affectedUsers: 0,
        createdAt: "2026-09-28T18:20:00+08:00"
      },
      {
        id: "audit-6",
        flagId: "flag-104",
        flagKey: "payment.aggregate-router",
        action: "approved",
        actor: "\u6797\u9ED8",
        summary: "\u786E\u8BA4\u56DE\u6EDA\u6761\u4EF6\u548C\u652F\u4ED8\u901A\u9053\u6307\u6807\u5B8C\u6574\u3002",
        before: "review",
        after: "active",
        affectedUsers: 32e5,
        createdAt: "2026-09-25T12:30:00+08:00"
      }
    ];
    seedDatabase = () => ({ flags, audit, issues, batches: [] });
    readDatabase = () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed2 = migrateDatabase(seedDatabase());
        writeDatabase(seed2);
        return seed2;
      }
      try {
        return migrateDatabase(JSON.parse(raw));
      } catch {
        const seed2 = migrateDatabase(seedDatabase());
        writeDatabase(seed2);
        return seed2;
      }
    };
    writeDatabase = (database) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    };
    applyReview = (flagId, payload) => {
      const db = readDatabase();
      const flag = db.flags.find((item) => item.id === flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const before = flag.status;
      flag.status = payload.decision === "approved" ? "active" : "draft";
      flag.enabled = payload.decision === "approved";
      flag.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      flag.lastChangedBy = payload.reviewer;
      db.audit.unshift({
        id: `audit-${Date.now()}`,
        flagId,
        flagKey: flag.key,
        action: payload.decision,
        actor: payload.reviewer,
        summary: payload.comment,
        before,
        after: flag.status,
        affectedUsers: Math.round(12e4 * (flag.rolloutPercentage / 100)),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (payload.freezeUntil && payload.decision === "approved") {
        flag.rollbackConditions.push(`\u51BB\u7ED3\u81F3 ${payload.freezeUntil}\uFF0C\u671F\u95F4\u7981\u6B62\u6269\u5927\u6D41\u91CF`);
      }
      syncHomeState(flag);
      writeDatabase(db);
      return flag;
    };
    rollbackFlag = (flagId, actor, reason) => {
      const db = readDatabase();
      const flag = db.flags.find((item) => item.id === flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const before = `${flag.status} / ${flag.rolloutPercentage}%`;
      flag.status = "rolled-back";
      flag.enabled = false;
      flag.rolloutPercentage = 0;
      flag.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      flag.lastChangedBy = actor;
      flag.rolloutSteps.forEach((step) => {
        if (step.status === "running") step.status = "paused";
      });
      syncHomeState(flag);
      db.audit.unshift({
        id: `audit-${Date.now()}`,
        flagId,
        flagKey: flag.key,
        action: "rolled-back",
        actor,
        summary: reason,
        before,
        after: "rolled-back / 0%",
        affectedUsers: Math.round(98e4 * (flag.rolloutPercentage / 100)),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      writeDatabase(db);
      return flag;
    };
    getDashboardStats = () => {
      const db = readDatabase();
      return {
        activeFlags: db.flags.filter((flag) => flag.enabled).length,
        pendingReview: db.flags.filter((flag) => flag.status === "review").length + 2,
        blockerIssues: db.issues.filter((issue) => issue.severity === "blocker" && !issue.resolved).length,
        affectedUsers: 5246900,
        environmentDiff: [
          { flag: "\u6781\u901F\u652F\u4ED8\u6D41\u7A0B V2", dev: 100, staging: 20, production: 0 },
          { flag: "\u8D26\u5355\u5F02\u6B65\u5BFC\u51FA V3", dev: 5, staging: 0, production: 0 },
          { flag: "\u5546\u54C1\u667A\u80FD\u63A8\u8350\u4F4D", dev: 100, staging: 50, production: 35 },
          { flag: "\u5B9E\u65F6\u7528\u6237\u7279\u5F81\u670D\u52A1", dev: 100, staging: 80, production: 60 }
        ],
        adoptionTrend: [
          { date: "09-23", flags: 18, rollbacks: 1 },
          { date: "09-24", flags: 21, rollbacks: 0 },
          { date: "09-25", flags: 19, rollbacks: 2 },
          { date: "09-26", flags: 24, rollbacks: 1 },
          { date: "09-27", flags: 27, rollbacks: 0 },
          { date: "09-28", flags: 31, rollbacks: 3 },
          { date: "09-29", flags: 29, rollbacks: 1 }
        ]
      };
    };
  }
});

// src/services/releaseBatchService.ts
var releaseBatchService_exports = {};
__export(releaseBatchService_exports, {
  applyBatch: () => applyBatch,
  armNextWriteFailure: () => armNextWriteFailure,
  batchSignature: () => batchSignature,
  compareVersions: () => compareVersions,
  confirmBatch: () => confirmBatch,
  createBatch: () => createBatch,
  environmentLabel: () => environmentLabel,
  fingerprintOf: () => fingerprintOf,
  isCreateLocked: () => isCreateLocked,
  listBatches: () => listBatches,
  mutateSourceEnvironment: () => mutateSourceEnvironment,
  nextEnvironment: () => nextEnvironment,
  raiseTargetMinVersion: () => raiseTargetMinVersion,
  refreshStaleness: () => refreshStaleness,
  regenerateCandidate: () => regenerateCandidate,
  rollbackBatch: () => rollbackBatch,
  rollbackDependencyForDemo: () => rollbackDependencyForDemo,
  runPreflight: () => runPreflight
});
var ENVIRONMENT_ORDER2, nextEnvironment, targetOf, environmentLabel, stableStringify, fingerprintOf, environmentFingerprint, snapshotOfState, newAuditId, newBatchId, newCandidateId, addAudit, batchSignature, openStatuses, findOpenBatch, LOCK_KEY, LOCK_TTL_MS, LOCK_WAIT_MS, isCreateLocked, acquireCreateLock, releaseCreateLock, waitForLock, validateSources, buildCandidate, refreshStaleness, createBatch, listBatches, regenerateCandidate, confirmBatch, compareVersions, runPreflight, writeCandidate, applyBatch, rollbackBatch, mutateSourceEnvironment, rollbackDependencyForDemo, raiseTargetMinVersion, armNextWriteFailure, bumpPatch, bumpMinor;
var init_releaseBatchService = __esm({
  "src/services/releaseBatchService.ts"() {
    init_database();
    ENVIRONMENT_ORDER2 = ["dev", "staging", "production"];
    nextEnvironment = (environment) => ENVIRONMENT_ORDER2[ENVIRONMENT_ORDER2.indexOf(environment) + 1];
    targetOf = (source) => {
      if (source === "production") throw new Error("\u751F\u4EA7\u73AF\u5883\u4E0D\u80FD\u7EE7\u7EED\u5411\u4E0A\u53D1\u5E03");
      return nextEnvironment(source);
    };
    environmentLabel = {
      dev: "DEV",
      staging: "STAGING",
      production: "PRODUCTION"
    };
    stableStringify = (value) => {
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
      }
      return JSON.stringify(value);
    };
    fingerprintOf = (value) => {
      const text = stableStringify(value);
      let hash = 5381;
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash << 5) + hash + text.charCodeAt(index) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    };
    environmentFingerprint = (state) => fingerprintOf({
      audienceRules: state.audienceRules,
      dependencies: state.dependencies,
      minClientVersion: state.minClientVersion,
      rolloutPercentage: state.rolloutPercentage,
      rolloutSteps: state.rolloutSteps
    });
    snapshotOfState = (state) => toCandidateSnapshot(state);
    newAuditId = () => `audit-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    newBatchId = () => `batch-${Date.now()}-${Math.round(Math.random() * 1e3)}`;
    newCandidateId = () => `cand-${Date.now()}-${Math.round(Math.random() * 1e3)}`;
    addAudit = (db, event) => {
      db.audit.unshift({
        id: newAuditId(),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ...event
      });
    };
    batchSignature = (flagId, sources) => `${flagId}->${sources.map(targetOf).join(">")}`;
    openStatuses = ["prepared", "confirmed", "running", "halted"];
    findOpenBatch = (db, input) => db.batches.find(
      (batch) => batch.flagId === input.flagId && openStatuses.includes(batch.status) && batchSignature(batch.flagId, batch.candidates.map((candidate) => candidate.sourceEnvironment)) === batchSignature(input.flagId, input.sources)
    );
    LOCK_KEY = "feature-flag-release-batch-create-lock";
    LOCK_TTL_MS = 4e3;
    LOCK_WAIT_MS = 1200;
    isCreateLocked = () => {
      const raw = localStorage.getItem(LOCK_KEY);
      if (!raw) return false;
      const lock = JSON.parse(raw);
      if (Date.now() - lock.at > LOCK_TTL_MS) {
        localStorage.removeItem(LOCK_KEY);
        return false;
      }
      return true;
    };
    acquireCreateLock = () => {
      if (isCreateLocked()) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify({ at: Date.now() }));
      const current = localStorage.getItem(LOCK_KEY);
      if (!current) return false;
      const lock = JSON.parse(current);
      return Date.now() - lock.at < LOCK_TTL_MS;
    };
    releaseCreateLock = () => localStorage.removeItem(LOCK_KEY);
    waitForLock = () => new Promise((resolve) => window.setTimeout(resolve, 250));
    validateSources = (sources) => {
      if (sources.length === 0) throw new Error("\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u6765\u6E90\u73AF\u5883");
      if (new Set(sources).size !== sources.length) throw new Error("\u540C\u4E00\u73AF\u5883\u4E0D\u80FD\u5728\u6279\u6B21\u4E2D\u91CD\u590D\u51FA\u73B0");
      sources.forEach((source, index) => {
        if (source === "production") throw new Error("\u751F\u4EA7\u73AF\u5883\u4E0D\u80FD\u4F5C\u4E3A\u53D1\u5E03\u6765\u6E90");
        if (index > 0 && sources[index - 1] !== ENVIRONMENT_ORDER2[ENVIRONMENT_ORDER2.indexOf(source) - 1]) {
          throw new Error("\u73AF\u5883\u5FC5\u987B\u6309 DEV \u2192 STAGING \u2192 PRODUCTION \u8FDE\u7EED\u63A8\u8FDB\uFF0C\u4E0D\u80FD\u8DF3\u7EA7\u6216\u4E71\u5E8F");
        }
      });
    };
    buildCandidate = (flag, source, createdAt) => {
      const sourceState = getEnvironmentState(flag, source);
      const snapshot = snapshotOfState(sourceState);
      return {
        id: newCandidateId(),
        sourceEnvironment: source,
        targetEnvironment: targetOf(source),
        status: "prepared",
        snapshot,
        snapshotHash: fingerprintOf(snapshot),
        sourceFingerprint: environmentFingerprint(sourceState),
        preparedAt: createdAt
      };
    };
    refreshStaleness = (flag, candidates) => candidates.map((candidate) => {
      if (candidate.status !== "prepared" || !flag) return candidate;
      const currentFingerprint = environmentFingerprint(getEnvironmentState(flag, candidate.sourceEnvironment));
      if (currentFingerprint !== candidate.sourceFingerprint) return { ...candidate, status: "stale" };
      return candidate;
    });
    createBatch = async (input) => {
      validateSources(input.sources);
      let waited = 0;
      while (isCreateLocked() && waited < LOCK_WAIT_MS) {
        await waitForLock();
        waited += 250;
      }
      {
        const db = readDatabase();
        const existing = findOpenBatch(db, input);
        if (existing) return { batch: existing, deduplicated: true };
      }
      if (!acquireCreateLock()) {
        let innerWait = 0;
        while (isCreateLocked() && innerWait < LOCK_WAIT_MS) {
          await waitForLock();
          innerWait += 250;
        }
        const db = readDatabase();
        const existing = findOpenBatch(db, input);
        if (existing) return { batch: existing, deduplicated: true };
        if (isCreateLocked()) throw new Error("\u53E6\u4E00\u4E2A\u7A97\u53E3\u6B63\u5728\u63D0\u4EA4\u540C\u4E00\u53D1\u5E03\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      }
      try {
        const db = readDatabase();
        const flag = db.flags.find((item) => item.id === input.flagId);
        if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
        const existing = findOpenBatch(db, input);
        if (existing) return { batch: existing, deduplicated: true };
        const createdAt = (/* @__PURE__ */ new Date()).toISOString();
        const batch = {
          id: newBatchId(),
          flagId: flag.id,
          flagKey: flag.key,
          status: "prepared",
          candidates: input.sources.map((source) => buildCandidate(flag, source, createdAt)),
          createdBy: input.createdBy,
          createdAt
        };
        db.batches.unshift(batch);
        addAudit(db, {
          flagId: flag.id,
          flagKey: flag.key,
          batchId: batch.id,
          action: "batch-created",
          actor: input.createdBy,
          summary: `\u4ECE ${input.sources.map((source) => environmentLabel[source]).join("\u3001")} \u751F\u6210\u4E0D\u53EF\u53D8\u53D1\u5E03\u5019\u9009\uFF0C\u7B49\u5F85\u786E\u8BA4\u3002`,
          affectedUsers: 0
        });
        writeDatabase(db);
        return { batch, deduplicated: false };
      } finally {
        releaseCreateLock();
      }
    };
    listBatches = () => {
      const db = readDatabase();
      let changed = false;
      db.batches.forEach((batch) => {
        const flag = db.flags.find((item) => item.id === batch.flagId);
        const next = refreshStaleness(flag, batch.candidates);
        next.forEach((candidate, index) => {
          if (candidate.status === "stale" && batch.candidates[index].status === "prepared") {
            changed = true;
            addAudit(db, {
              flagId: batch.flagId,
              flagKey: batch.flagKey,
              batchId: batch.id,
              targetEnvironment: candidate.targetEnvironment,
              action: "batch-candidate-stale",
              actor: "\u7CFB\u7EDF",
              summary: `\u5019\u9009 ${environmentLabel[candidate.sourceEnvironment]} \u2192 ${environmentLabel[candidate.targetEnvironment]} \u7684\u6765\u6E90\u5728\u786E\u8BA4\u524D\u53D1\u751F\u53D8\u5316\uFF0C\u5019\u9009\u5DF2\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u751F\u6210\u3002`,
              affectedUsers: 0
            });
          }
        });
        if (next.some((candidate, index) => candidate !== batch.candidates[index])) {
          batch.candidates = next;
          changed = true;
        }
      });
      if (changed) writeDatabase(db);
      return clone(db.batches);
    };
    regenerateCandidate = (batchId2, candidateId, actor) => {
      const db = readDatabase();
      const batch = db.batches.find((item) => item.id === batchId2);
      if (!batch) throw new Error("\u53D1\u5E03\u6279\u6B21\u4E0D\u5B58\u5728");
      if (!["prepared"].includes(batch.status)) throw new Error("\u6279\u6B21\u5DF2\u786E\u8BA4\uFF0C\u5019\u9009\u4E0D\u80FD\u91CD\u65B0\u751F\u6210");
      const flag = db.flags.find((item) => item.id === batch.flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const index = batch.candidates.findIndex((candidate) => candidate.id === candidateId);
      if (index < 0) throw new Error("\u5019\u9009\u4E0D\u5B58\u5728");
      if (batch.candidates[index].status !== "stale") throw new Error("\u53EA\u6709\u5931\u6548\u5019\u9009\u9700\u8981\u91CD\u65B0\u751F\u6210");
      const regenerated2 = buildCandidate(flag, batch.candidates[index].sourceEnvironment, (/* @__PURE__ */ new Date()).toISOString());
      batch.candidates[index] = regenerated2;
      addAudit(db, {
        flagId: batch.flagId,
        flagKey: batch.flagKey,
        batchId: batch.id,
        targetEnvironment: regenerated2.targetEnvironment,
        action: "batch-regenerated",
        actor,
        summary: `\u4ECE ${environmentLabel[regenerated2.sourceEnvironment]} \u91CD\u65B0\u51BB\u7ED3\u5019\u9009\uFF08\u65B0\u6307\u7EB9 ${regenerated2.snapshotHash}\uFF09\u3002`,
        affectedUsers: 0
      });
      writeDatabase(db);
      return clone(batch);
    };
    confirmBatch = (batchId2, actor) => {
      const db = readDatabase();
      const batch = db.batches.find((item) => item.id === batchId2);
      if (!batch) throw new Error("\u53D1\u5E03\u6279\u6B21\u4E0D\u5B58\u5728");
      if (batch.status !== "prepared") throw new Error("\u53EA\u6709\u5F85\u786E\u8BA4\u6279\u6B21\u53EF\u4EE5\u786E\u8BA4");
      const flag = db.flags.find((item) => item.id === batch.flagId);
      batch.candidates = refreshStaleness(flag, batch.candidates);
      const stale2 = batch.candidates.filter((candidate) => candidate.status === "stale");
      if (stale2.length > 0) throw new Error("\u5B58\u5728\u5DF2\u5931\u6548\u5019\u9009\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u540E\u518D\u786E\u8BA4");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      batch.status = "confirmed";
      batch.confirmedAt = now;
      batch.candidates.forEach((candidate) => {
        candidate.status = "confirmed";
        candidate.confirmedAt = now;
      });
      addAudit(db, {
        flagId: batch.flagId,
        flagKey: batch.flagKey,
        batchId: batch.id,
        action: "batch-confirmed",
        actor,
        summary: `\u6279\u6B21\u5DF2\u786E\u8BA4\uFF0C${batch.candidates.length} \u4E2A\u5019\u9009\u5185\u5BB9\u9501\u5B9A\uFF1A\u53D7\u4F17\u3001\u4F9D\u8D56\u3001\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C\u4E0E\u7070\u5EA6\u9636\u6BB5\u4E0D\u53EF\u53D8\u3002`,
        affectedUsers: 0
      });
      writeDatabase(db);
      return clone(batch);
    };
    compareVersions = (a, b) => {
      const partsOf = (version) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
      const pa = partsOf(a);
      const pb = partsOf(b);
      for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
        const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
      return 0;
    };
    runPreflight = (batchId2) => {
      const db = readDatabase();
      const batch = db.batches.find((item) => item.id === batchId2);
      if (!batch) throw new Error("\u53D1\u5E03\u6279\u6B21\u4E0D\u5B58\u5728");
      const flag = db.flags.find((item) => item.id === batch.flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const findings2 = [];
      batch.candidates.forEach((candidate) => {
        if (candidate.status === "applied" || candidate.status === "rolled-back") return;
        const push = (finding) => findings2.push({ candidateId: candidate.id, ...finding });
        const liveSource = getEnvironmentState(flag, candidate.sourceEnvironment);
        if (environmentFingerprint(liveSource) !== candidate.sourceFingerprint) {
          push({
            code: "environment-order",
            severity: "blocker",
            message: `${environmentLabel[candidate.sourceEnvironment]} \u6765\u6E90\u5728\u5019\u9009\u786E\u8BA4\u540E\u53D1\u751F\u53D8\u5316\uFF0C\u73AF\u5883\u94FE\u8DEF\u72B6\u6001\u4E0E\u9501\u5B9A\u5019\u9009\u51B2\u7A81\uFF0C\u6574\u6279\u505C\u6B62\u3002`
          });
        }
        const liveTarget = getEnvironmentState(flag, candidate.targetEnvironment);
        if (liveTarget.rolloutPercentage !== 0 && liveTarget.rolloutPercentage >= candidate.snapshot.rolloutPercentage && compareVersions(liveTarget.minClientVersion, candidate.snapshot.minClientVersion) > 0) {
          push({
            code: "environment-order",
            severity: "blocker",
            message: `${environmentLabel[candidate.targetEnvironment]} \u5DF2\u5B58\u5728\u66F4\u9AD8\u7248\u672C\u7684\u5728\u9014\u53D1\u5E03\uFF0C\u4E0D\u80FD\u6309\u672C\u6279\u6B21\u987A\u5E8F\u8986\u76D6\u3002`
          });
        }
        candidate.snapshot.dependencies.filter((dependency) => dependency.type === "requires").forEach((dependency) => {
          const dependencyFlag = db.flags.find((item) => item.id === dependency.flagId);
          if (!dependencyFlag) return;
          const dependencyTarget = getEnvironmentState(dependencyFlag, candidate.targetEnvironment);
          if (dependencyTarget.status === "rolled-back" || !dependencyTarget.enabled) {
            push({
              code: "dependency-rolled-back",
              severity: "blocker",
              message: `\u524D\u7F6E\u4F9D\u8D56\u300C${dependencyFlag.name}\u300D\u5728 ${environmentLabel[candidate.targetEnvironment]} \u5DF2${dependencyTarget.status === "rolled-back" ? "\u56DE\u6EDA" : "\u672A\u542F\u7528"}\uFF0C\u4E0D\u80FD\u5E26\u7740\u8BE5\u5019\u9009\u7EE7\u7EED\u53D1\u5E03\u3002`
            });
          }
          if (compareVersions(dependencyTarget.minClientVersion, candidate.snapshot.minClientVersion) > 0) {
            push({
              code: "dependency-version",
              severity: "blocker",
              message: `\u524D\u7F6E\u4F9D\u8D56\u300C${dependencyFlag.name}\u300D\u8981\u6C42\u6700\u4F4E\u5BA2\u6237\u7AEF ${dependencyTarget.minClientVersion}\uFF0C\u9AD8\u4E8E\u5019\u9009\u7684 ${candidate.snapshot.minClientVersion}\uFF0C\u7248\u672C\u4E0D\u6EE1\u8DB3\u3002`
            });
          }
        });
        candidate.snapshot.dependencies.filter((dependency) => dependency.type === "conflicts").forEach((dependency) => {
          const conflictFlag = db.flags.find((item) => item.id === dependency.flagId);
          if (!conflictFlag) return;
          const conflictTarget = getEnvironmentState(conflictFlag, candidate.targetEnvironment);
          if (conflictTarget.enabled && conflictTarget.status === "active") {
            push({
              code: "conflict-active",
              severity: "blocker",
              message: `\u4E92\u65A5\u5F00\u5173\u300C${conflictFlag.name}\u300D\u5728 ${environmentLabel[candidate.targetEnvironment]} \u4ECD\u5904\u4E8E\u542F\u7528\u72B6\u6001\u3002`
            });
          }
        });
        if (compareVersions(candidate.snapshot.minClientVersion, liveTarget.minClientVersion) < 0) {
          push({
            code: "version-regression",
            severity: "blocker",
            message: `\u5019\u9009\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C ${candidate.snapshot.minClientVersion} \u4F4E\u4E8E ${environmentLabel[candidate.targetEnvironment]} \u5F53\u524D\u95E8\u69DB ${liveTarget.minClientVersion}\uFF0C\u53D1\u5E03\u5C06\u9020\u6210\u7248\u672C\u5012\u9000\u3002`
          });
        }
      });
      return findings2;
    };
    writeCandidate = (db, flag, candidate, batchId2, actor) => {
      const target = candidate.targetEnvironment;
      const previous = getEnvironmentState(flag, target);
      candidate.preApplyAnchor = snapshotOfState(previous);
      const snapshot = candidate.snapshot;
      const nextState = {
        environment: target,
        status: "active",
        enabled: true,
        rolloutPercentage: snapshot.rolloutPercentage,
        audienceRules: clone(snapshot.audienceRules),
        dependencies: clone(snapshot.dependencies),
        rolloutSteps: clone(snapshot.rolloutSteps),
        minClientVersion: snapshot.minClientVersion,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      flag.environmentStates[target] = nextState;
      flag.minClientVersion[target] = snapshot.minClientVersion;
      if (flag.environment === target) {
        flag.status = "active";
        flag.enabled = true;
        flag.rolloutPercentage = snapshot.rolloutPercentage;
        flag.audienceRules = clone(snapshot.audienceRules);
        flag.dependencies = clone(snapshot.dependencies);
        flag.rolloutSteps = clone(snapshot.rolloutSteps);
      }
      flag.updatedAt = nextState.updatedAt;
      addAudit(db, {
        flagId: flag.id,
        flagKey: flag.key,
        batchId: batchId2,
        targetEnvironment: target,
        action: "batch-applied",
        actor,
        summary: `\u5019\u9009 ${environmentLabel[candidate.sourceEnvironment]} \u2192 ${environmentLabel[target]} \u5DF2\u5199\u5165\uFF1A\u53D7\u4F17 ${snapshot.audienceRules.length} \u6761\u3001\u4F9D\u8D56 ${snapshot.dependencies.length} \u9879\u3001\u7070\u5EA6 ${snapshot.rolloutPercentage}%\u3001\u6700\u4F4E\u7248\u672C ${snapshot.minClientVersion}\u3002`,
        affectedUsers: Math.round(9e5 * (snapshot.rolloutPercentage / 100))
      });
    };
    applyBatch = (batchId2, actor) => {
      const db = readDatabase();
      const batch = db.batches.find((item) => item.id === batchId2);
      if (!batch) throw new Error("\u53D1\u5E03\u6279\u6B21\u4E0D\u5B58\u5728");
      if (!["confirmed", "halted"].includes(batch.status)) throw new Error("\u5F53\u524D\u6279\u6B21\u72B6\u6001\u4E0D\u80FD\u6267\u884C\u53D1\u5E03");
      const flag = db.flags.find((item) => item.id === batch.flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      batch.candidates.forEach((candidate) => {
        if (candidate.status === "skipped" || candidate.status === "failed") {
          candidate.status = "confirmed";
          candidate.failureReason = void 0;
        }
      });
      batch.status = "running";
      batch.haltReason = void 0;
      const findings2 = runPreflight(batchId2);
      const findingsByCandidate = /* @__PURE__ */ new Map();
      findings2.forEach((finding) => {
        const list = findingsByCandidate.get(finding.candidateId) ?? [];
        list.push(finding);
        findingsByCandidate.set(finding.candidateId, list);
      });
      let halted = false;
      const ordered = [...batch.candidates].sort(
        (a, b) => ENVIRONMENT_ORDER2.indexOf(a.targetEnvironment) - ENVIRONMENT_ORDER2.indexOf(b.targetEnvironment)
      );
      for (const candidate of ordered) {
        const candidateStatus = candidate.status;
        if (candidateStatus === "applied") continue;
        const blockers = (findingsByCandidate.get(candidate.id) ?? []).filter(
          (finding) => finding.severity === "blocker"
        );
        if (blockers.length > 0 || halted) {
          halted = true;
          if (candidate.status !== "applied") candidate.status = "skipped";
          continue;
        }
        try {
          const willFail = localStorage.getItem(BATCH_FAILURE_KEY) === candidate.targetEnvironment;
          if (willFail) {
            localStorage.removeItem(BATCH_FAILURE_KEY);
            throw new Error("\u914D\u7F6E\u670D\u52A1\u5199\u5165\u8D85\u65F6\uFF08\u6A21\u62DF\u5931\u8D25\uFF09");
          }
          writeCandidate(db, flag, candidate, batch.id, actor);
          candidate.status = "applied";
          candidate.appliedAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (error) {
          candidate.status = "failed";
          candidate.failureReason = error instanceof Error ? error.message : "\u5199\u5165\u5931\u8D25";
          halted = true;
        }
      }
      if (halted) {
        batch.status = "halted";
        batch.haltedAt = (/* @__PURE__ */ new Date()).toISOString();
        const firstBlocker = ordered.map((candidate) => findingsByCandidate.get(candidate.id)?.[0]).find((finding) => finding?.severity === "blocker");
        const failed = ordered.find((candidate) => candidate.status === "failed");
        batch.haltReason = failed?.failureReason ?? firstBlocker?.message ?? "\u53D1\u5E03\u5728\u4E2D\u9014\u505C\u6B62";
        addAudit(db, {
          flagId: batch.flagId,
          flagKey: batch.flagKey,
          batchId: batch.id,
          action: "batch-halted",
          actor: "\u7CFB\u7EDF",
          summary: `\u6574\u6279\u505C\u6B62\uFF1A${batch.haltReason} \u672A\u5B8C\u6210\u5019\u9009\u5DF2\u4FDD\u7559\uFF0C\u53EF\u4ECE\u4FDD\u7559\u9879\u91CD\u8BD5\u3002`,
          affectedUsers: 0
        });
      } else if (batch.candidates.every((candidate) => candidate.status === "applied")) {
        batch.status = "applied";
        batch.appliedAt = (/* @__PURE__ */ new Date()).toISOString();
      } else {
        batch.status = "halted";
      }
      writeDatabase(db);
      return { batch: clone(batch), findings: findings2 };
    };
    rollbackBatch = (batchId2, actor, reason) => {
      if (reason.trim().length < 8) throw new Error("\u56DE\u6EDA\u539F\u56E0\u81F3\u5C11 8 \u4E2A\u5B57\u7B26");
      const db = readDatabase();
      const batch = db.batches.find((item) => item.id === batchId2);
      if (!batch) throw new Error("\u53D1\u5E03\u6279\u6B21\u4E0D\u5B58\u5728");
      const applied2 = batch.candidates.filter(
        (candidate) => candidate.status === "applied" || candidate.status === "failed"
      );
      if (applied2.length === 0) throw new Error("\u6279\u6B21\u4E2D\u6CA1\u6709\u5DF2\u5199\u5165\u7684\u73AF\u5883\uFF0C\u65E0\u9700\u56DE\u6EDA");
      const flag = db.flags.find((item) => item.id === batch.flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const reversed = [...applied2].sort(
        (a, b) => ENVIRONMENT_ORDER2.indexOf(b.targetEnvironment) - ENVIRONMENT_ORDER2.indexOf(a.targetEnvironment)
      );
      reversed.forEach((candidate) => {
        const target = candidate.targetEnvironment;
        const anchor = candidate.preApplyAnchor ?? snapshotOfState(getEnvironmentState(flag, target));
        const state = getEnvironmentState(flag, target);
        state.audienceRules = clone(anchor.audienceRules);
        state.dependencies = clone(anchor.dependencies);
        state.rolloutSteps = clone(anchor.rolloutSteps);
        state.rolloutPercentage = anchor.rolloutPercentage;
        state.status = "rolled-back";
        state.enabled = false;
        state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        flag.environmentStates[target] = state;
        if (flag.environment === target) {
          flag.status = "rolled-back";
          flag.enabled = false;
          flag.rolloutPercentage = anchor.rolloutPercentage;
          flag.audienceRules = clone(anchor.audienceRules);
          flag.dependencies = clone(anchor.dependencies);
          flag.rolloutSteps = clone(anchor.rolloutSteps);
        }
        flag.updatedAt = state.updatedAt;
        candidate.status = "rolled-back";
        addAudit(db, {
          flagId: flag.id,
          flagKey: flag.key,
          batchId: batch.id,
          targetEnvironment: target,
          action: "batch-rolled-back",
          actor,
          summary: `\u56DE\u6EDA ${environmentLabel[target]}\uFF1A\u4EC5\u6062\u590D\u53D1\u5E03\u524D\u951A\u70B9\u4E2D\u7684\u53D7\u4F17\uFF08${anchor.audienceRules.length} \u6761\uFF09\u3001\u4F9D\u8D56\uFF08${anchor.dependencies.length} \u9879\uFF09\u4E0E\u7070\u5EA6\u9636\u6BB5\uFF08${anchor.rolloutSteps.length} \u4E2A\u3001\u7070\u5EA6 ${anchor.rolloutPercentage}%\uFF09\uFF0C\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C\u4FDD\u6301 ${state.minClientVersion} \u4E0D\u53D8\uFF1B\u539F\u5BA1\u8BA1\u4ECD\u4FDD\u7559\u53EF\u67E5\u3002\u539F\u56E0\uFF1A${reason}`,
          affectedUsers: 0
        });
      });
      batch.status = "rolled-back";
      batch.rolledBackAt = (/* @__PURE__ */ new Date()).toISOString();
      batch.rollbackReason = reason;
      writeDatabase(db);
      return clone(batch);
    };
    mutateSourceEnvironment = (flagId, environment, actor) => {
      const db = readDatabase();
      const flag = db.flags.find((item) => item.id === flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const state = getEnvironmentState(flag, environment);
      state.minClientVersion = bumpPatch(state.minClientVersion);
      flag.minClientVersion[environment] = state.minClientVersion;
      flag.environmentStates[environment] = state;
      if (flag.environment === environment) syncHomeState(flag);
      addAudit(db, {
        flagId: flag.id,
        flagKey: flag.key,
        action: "updated",
        actor,
        summary: `${environmentLabel[environment]} \u6765\u6E90\u4F9D\u8D56/\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C\u8C03\u6574\u4E3A ${state.minClientVersion}\uFF0C\u672A\u786E\u8BA4\u5019\u9009\u5C06\u56E0\u6B64\u5931\u6548\u3002`,
        after: state.minClientVersion,
        affectedUsers: 0
      });
      writeDatabase(db);
      return listBatches();
    };
    rollbackDependencyForDemo = (dependencyFlagId, environment, actor) => {
      const db = readDatabase();
      const dependency = db.flags.find((item) => item.id === dependencyFlagId);
      if (!dependency) throw new Error("\u4F9D\u8D56\u5F00\u5173\u4E0D\u5B58\u5728");
      const state = getEnvironmentState(dependency, environment);
      state.status = "rolled-back";
      state.enabled = false;
      state.rolloutPercentage = 0;
      state.rolloutSteps = state.rolloutSteps.map(
        (step) => step.status === "running" ? { ...step, status: "paused" } : step
      );
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      dependency.environmentStates[environment] = state;
      if (dependency.environment === environment) {
        dependency.status = "rolled-back";
        dependency.enabled = false;
        dependency.rolloutPercentage = 0;
        dependency.rolloutSteps = clone(state.rolloutSteps);
      }
      addAudit(db, {
        flagId: dependency.id,
        flagKey: dependency.key,
        action: "rolled-back",
        actor,
        summary: `${environmentLabel[environment]} \u4F9D\u8D56\u88AB\u56DE\u6EDA\uFF0C\u5F15\u7528\u5B83\u7684\u53D1\u5E03\u6279\u6B21\u9884\u68C0\u5C06\u88AB\u963B\u65AD\u3002`,
        after: "rolled-back / 0%",
        affectedUsers: 0
      });
      writeDatabase(db);
    };
    raiseTargetMinVersion = (flagId, environment, actor) => {
      const db = readDatabase();
      const flag = db.flags.find((item) => item.id === flagId);
      if (!flag) throw new Error("\u529F\u80FD\u5F00\u5173\u4E0D\u5B58\u5728");
      const state = getEnvironmentState(flag, environment);
      state.minClientVersion = bumpMinor(state.minClientVersion);
      flag.minClientVersion[environment] = state.minClientVersion;
      flag.environmentStates[environment] = state;
      if (flag.environment === environment) syncHomeState(flag);
      addAudit(db, {
        flagId: flag.id,
        flagKey: flag.key,
        action: "updated",
        actor,
        summary: `${environmentLabel[environment]} \u5F53\u524D\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C\u4E0A\u8C03\u4E3A ${state.minClientVersion}\uFF0C\u65E7\u5BA1\u6838\u653E\u884C\u7684\u5019\u9009\u5C06\u4E0D\u6EE1\u8DB3\u7248\u672C\u8981\u6C42\u3002`,
        after: state.minClientVersion,
        affectedUsers: 0
      });
      writeDatabase(db);
    };
    armNextWriteFailure = (environment) => {
      localStorage.setItem(BATCH_FAILURE_KEY, environment);
    };
    bumpPatch = (version) => {
      const parts = version.split(".");
      parts[parts.length - 1] = String((Number.parseInt(parts.at(-1) ?? "0", 10) || 0) + 1);
      return parts.join(".");
    };
    bumpMinor = (version) => {
      const parts = version.split(".");
      parts[1] = String((Number.parseInt(parts[1] ?? "0", 10) || 0) + 2);
      return parts.join(".");
    };
  }
});

// scripts/releaseBatch.e2e.ts
var store = /* @__PURE__ */ new Map();
var localStorageShim = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => void store.set(key, value),
  removeItem: (key) => void store.delete(key)
};
globalThis.localStorage = localStorageShim;
globalThis.window = {
  setTimeout: (fn) => setTimeout(fn, 0)
};
var assert = (condition, message) => {
  if (!condition) {
    console.error(`\u2717 ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`\u2713 ${message}`);
};
var seed = (await Promise.resolve().then(() => (init_database(), database_exports))).seedDatabase;
var { writeDatabase: writeDatabase2, getEnvironmentState: getEnvironmentState2, BATCH_FAILURE_KEY: BATCH_FAILURE_KEY2 } = await Promise.resolve().then(() => (init_database(), database_exports));
var service = await Promise.resolve().then(() => (init_releaseBatchService(), releaseBatchService_exports));
var migrated = (await Promise.resolve().then(() => (init_database(), database_exports))).readDatabase();
assert(migrated.batches.length === 0, "\u8FC1\u79FB\u540E\u6279\u6B21\u8868\u4E3A\u7A7A");
assert(Boolean(migrated.flags[0].environmentStates.staging), "\u8FC1\u79FB\u8865\u9F50\u4E3B\u73AF\u5883\u72B6\u6001");
var created = await service.createBatch({ flagId: "flag-101", sources: ["staging"], createdBy: "\u6D4B\u8BD5" });
assert(!created.deduplicated, "\u9996\u6B21\u521B\u5EFA\u4E0D\u662F\u53BB\u91CD\u590D\u7528");
var batchId = created.batch.id;
assert(created.batch.candidates[0].status === "prepared", "\u5019\u9009\u521D\u59CB\u4E3A\u5F85\u786E\u8BA4");
assert(created.batch.candidates[0].snapshotHash.length === 8, "\u5019\u9009\u5E26\u5185\u5BB9\u6307\u7EB9");
var duplicate = await service.createBatch({ flagId: "flag-101", sources: ["staging"], createdBy: "\u7A97\u53E3B" });
assert(duplicate.deduplicated && duplicate.batch.id === batchId, "\u5E76\u53D1/\u91CD\u590D\u63D0\u4EA4\u590D\u7528\u540C\u4E00\u6279\u6B21");
service.mutateSourceEnvironment("flag-101", "staging", "\u53D1\u5E03\u7ECF\u7406");
var stale = service.listBatches().find((b) => b.id === batchId);
assert(stale.candidates[0].status === "stale", "\u6765\u6E90\u53D8\u66F4\u540E\u5019\u9009\u5931\u6548");
var confirmFailed = false;
try {
  service.confirmBatch(batchId, "\u6D4B\u8BD5");
} catch {
  confirmFailed = true;
}
assert(confirmFailed, "\u5B58\u5728\u5931\u6548\u5019\u9009\u65F6\u786E\u8BA4\u88AB\u62D2\u7EDD");
var regenerated = service.regenerateCandidate(batchId, stale.candidates[0].id, "\u6D4B\u8BD5");
assert(regenerated.candidates[0].status === "prepared", "\u91CD\u65B0\u751F\u6210\u540E\u5019\u9009\u56DE\u5230\u5F85\u786E\u8BA4");
var confirmed = service.confirmBatch(batchId, "\u6D4B\u8BD5");
assert(confirmed.status === "confirmed" && confirmed.candidates[0].status === "confirmed", "\u6279\u6B21\u4E0E\u5019\u9009\u5DF2\u786E\u8BA4\u9501\u5B9A");
service.mutateSourceEnvironment("flag-101", "staging", "\u53D1\u5E03\u7ECF\u7406");
service.rollbackDependencyForDemo("flag-104", "production", "\u5E73\u53F0");
var findings = service.runPreflight(batchId);
var codes = findings.map((f) => f.code);
assert(codes.includes("environment-order"), "\u9884\u68C0\u62A5\u73AF\u5883\u987A\u5E8F\u51B2\u7A81");
assert(codes.includes("dependency-rolled-back"), "\u9884\u68C0\u62A5\u4F9D\u8D56\u5DF2\u56DE\u6EDA");
var applied = service.applyBatch(batchId, "\u6D4B\u8BD5");
assert(applied.batch.status === "halted", "\u963B\u65AD\u65F6\u6574\u6279\u505C\u6B62");
assert(applied.batch.candidates[0].status === "skipped", "\u672A\u6267\u884C\u5019\u9009\u4FDD\u7559\u4E3A\u672A\u5B8C\u6210\u9879");
applied = service.applyBatch(batchId, "\u6D4B\u8BD5");
assert(applied.batch.status === "halted", "\u95EE\u9898\u672A\u4FEE\u590D\u524D\u91CD\u8BD5\u4ECD\u505C\u6B62");
var fresh = await service.createBatch({ flagId: "flag-101", sources: ["staging"], createdBy: "\u6D4B\u8BD52" });
assert(fresh.deduplicated === true, "\u65E7\u6279\u6B21\u672A\u7ED3\u675F\u65F6\u540C\u94FE\u8DEF\u521B\u5EFA\u4ECD\u53BB\u91CD");
{
  const dbModule = await Promise.resolve().then(() => (init_database(), database_exports));
  const db = dbModule.readDatabase();
  const dep = db.flags.find((f) => f.id === "flag-104");
  dep.environmentStates.production = {
    environment: "production",
    status: "active",
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    dependencies: [],
    rolloutSteps: [],
    minClientVersion: dep.minClientVersion.production,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  dbModule.writeDatabase(db);
}
findings = service.runPreflight(batchId);
assert(!findings.some((f) => f.code === "dependency-rolled-back"), "\u4F9D\u8D56\u6062\u590D\u540E\u4F9D\u8D56\u963B\u65AD\u6D88\u5931");
assert(findings.some((f) => f.code === "environment-order"), "\u6765\u6E90\u6F02\u79FB\u7684\u987A\u5E8F\u51B2\u7A81\u4ECD\u5728");
service.raiseTargetMinVersion("flag-101", "production", "\u8BC4\u5BA1\u4EBA");
findings = service.runPreflight(batchId);
assert(findings.some((f) => f.code === "version-regression"), "\u751F\u4EA7\u62AC\u9AD8\u7248\u672C\u540E\u62A5\u7248\u672C\u5012\u9000");
{
  const dbModule = await Promise.resolve().then(() => (init_database(), database_exports));
  const db = dbModule.readDatabase();
  const dep = db.flags.find((f) => f.id === "flag-107");
  dep.environmentStates.staging = {
    environment: "staging",
    status: "active",
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    dependencies: [],
    rolloutSteps: [{ id: "q701", percentage: 100, audience: "\u9884\u53D1\u957F\u4EFB\u52A1", startedAt: "2026-09-22T09:00:00+08:00", status: "completed", guardrails: [] }],
    minClientVersion: dep.minClientVersion.staging,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  dbModule.writeDatabase(db);
}
var batch3 = await service.createBatch({ flagId: "flag-103", sources: ["dev"], createdBy: "\u6D4B\u8BD53" });
assert(!batch3.deduplicated, "\u4E0D\u540C\u94FE\u8DEF/\u5F00\u5173\u53EF\u72EC\u7ACB\u5EFA\u6279");
var batch3Id = batch3.batch.id;
service.confirmBatch(batch3Id, "\u6D4B\u8BD53");
assert(service.runPreflight(batch3Id).filter((f) => f.severity === "blocker").length === 0, "flag-103 dev\u2192staging \u9884\u68C0\u901A\u8FC7");
localStorageShim.setItem(BATCH_FAILURE_KEY2, "staging");
var ran3 = service.applyBatch(batch3Id, "\u6D4B\u8BD53");
assert(ran3.batch.status === "halted", "\u6CE8\u5165\u5199\u5165\u5931\u8D25\u540E\u6279\u6B21\u505C\u6B62");
assert(ran3.batch.candidates[0].status === "failed", "\u5931\u8D25\u5019\u9009\u4FDD\u7559 failed \u4E0E\u539F\u56E0");
assert(Boolean(ran3.batch.candidates[0].failureReason), "\u5931\u8D25\u539F\u56E0\u5DF2\u4FDD\u7559");
localStorageShim.removeItem(BATCH_FAILURE_KEY2);
ran3 = service.applyBatch(batch3Id, "\u6D4B\u8BD53");
assert(ran3.batch.status === "applied", "\u4ECE\u4FDD\u7559\u7684\u672A\u5B8C\u6210\u9879\u91CD\u8BD5\u540E\u6574\u6279\u5B8C\u6210");
assert(ran3.batch.candidates[0].status === "applied", "\u91CD\u8BD5\u5019\u9009\u6210\u529F\u5199\u5165");
{
  const dbModule = await Promise.resolve().then(() => (init_database(), database_exports));
  const db = dbModule.readDatabase();
  const flag = db.flags.find((f) => f.id === "flag-103");
  const staging = getEnvironmentState2(flag, "staging");
  assert(staging.enabled === true && staging.status === "active", "staging \u5DF2\u542F\u7528");
  assert(staging.audienceRules.length === 1, "staging \u53D7\u4F17\u6765\u81EA\u5019\u9009\u5FEB\u7167");
}
{
  const dbModule = await Promise.resolve().then(() => (init_database(), database_exports));
  const beforeAudit = dbModule.readDatabase().audit.length;
  const rolled = service.rollbackBatch(batch3Id, "\u6D4B\u8BD53", "\u6307\u6807\u5F02\u5E38\u89E6\u53D1\u6574\u6279\u56DE\u6EDA\u9A8C\u8BC1");
  assert(rolled.status === "rolled-back", "\u6279\u6B21\u5DF2\u56DE\u6EDA");
  const db = dbModule.readDatabase();
  const flag = db.flags.find((f) => f.id === "flag-103");
  const staging = getEnvironmentState2(flag, "staging");
  assert(staging.enabled === false && staging.status === "rolled-back", "\u56DE\u6EDA\u540E\u76EE\u6807\u5173\u95ED");
  assert(staging.audienceRules.length === 0, "\u56DE\u6EDA\u53EA\u6062\u590D\u5199\u5165\u524D\u951A\u70B9\u7684\u53D7\u4F17\uFF08\u7A7A\uFF09");
  assert(staging.minClientVersion === "5.10.0", "\u56DE\u6EDA\u4E0D\u6539\u6700\u4F4E\u5BA2\u6237\u7AEF\u7248\u672C");
  assert(db.audit.length >= beforeAudit + 1, "\u56DE\u6EDA\u53EA\u8FFD\u52A0\u5BA1\u8BA1\uFF0C\u5386\u53F2\u5BA1\u8BA1\u4ECD\u5728");
  const batchEvents = db.audit.filter((e) => e.batchId === batch3Id).map((e) => e.action);
  assert(batchEvents.includes("batch-created"), "\u6279\u6B21\u521B\u5EFA\u5BA1\u8BA1\u53EF\u67E5");
  assert(batchEvents.includes("batch-applied"), "\u5019\u9009\u5199\u5165\u5BA1\u8BA1\u53EF\u67E5");
  assert(batchEvents.includes("batch-rolled-back"), "\u6279\u6B21\u56DE\u6EDA\u5BA1\u8BA1\u53EF\u67E5");
}
for (const bad of [
  { sources: ["production"] },
  { sources: ["staging", "dev"] }
]) {
  let rejected = false;
  try {
    await service.createBatch({ flagId: "flag-103", sources: [...bad.sources], createdBy: "x" });
  } catch {
    rejected = true;
  }
  assert(rejected, `\u975E\u6CD5\u73AF\u5883\u5E8F\u5217\u88AB\u62D2\u7EDD: ${bad.sources.join(",")}`);
}
console.log("\n\u5168\u90E8\u9886\u57DF\u65AD\u8A00\u901A\u8FC7\u3002");
