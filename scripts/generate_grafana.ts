import { writeFile } from "node:fs/promises";

import { PanelBuilder as BarGaugePanelBuilder } from "@grafana/grafana-foundation-sdk/bargauge";
import {
  DashboardBuilder,
  ThresholdsConfigBuilder,
} from "@grafana/grafana-foundation-sdk/dashboard";
import { PanelBuilder as GaugePanelBuilder } from "@grafana/grafana-foundation-sdk/gauge";
import { DataqueryBuilder } from "@grafana/grafana-foundation-sdk/prometheus";
import { PanelBuilder as StatPanelBuilder } from "@grafana/grafana-foundation-sdk/stat";
import { PanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";

const sortGaugesByHost = {
  id: "sortBy",
  options: {
    fields: {
      host: false,
    },
  },
};

const sortGaugesByBotName = {
  id: "sortBy",
  options: {
    fields: {
      botName: false,
    },
  },
};

const healthyThresholds = new ThresholdsConfigBuilder().steps([
  { color: "red", value: null },
  { color: "green", value: 1 },
]);

const playerHealthThresholds = new ThresholdsConfigBuilder().steps([
  { color: "red", value: null },
  { color: "yellow", value: 7 },
  { color: "green", value: 14 },
]);

const worldRowsQuery = {
  build: () => ({
    format: "table",
    rawSql: 'SELECT COUNT(*) AS "World rows" FROM "World"',
    refId: "A",
  }),
} as unknown as DataqueryBuilder;

const filesystemDashboard = () =>
  new DashboardBuilder("Node filesystem")
    .uid("node-filesystem")
    .tags(["generated"])
    .refresh("30s")
    .time({ from: "now-1h", to: "now" })
    .timezone("browser")
    .withPanel(
      new PanelBuilder()
        .title("Root filesystem usage percentage")
        .description("Percentage of the root filesystem in use.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - node_filesystem_avail_bytes{host!="",mountpoint="/"} / node_filesystem_size_bytes{host!="",mountpoint="/"})',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new GaugePanelBuilder()
        .title("Root filesystem usage percentage gauge")
        .description("Current percentage of the root filesystem in use.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTransformation(sortGaugesByHost)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - node_filesystem_avail_bytes{host!="",mountpoint="/"} / node_filesystem_size_bytes{host!="",mountpoint="/"})',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new PanelBuilder()
        .title("Memory usage percentage")
        .description(
          "Percentage of memory currently in use, based on available memory.",
        )
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - node_memory_MemAvailable_bytes{host!=""} / node_memory_MemTotal_bytes{host!=""})',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new GaugePanelBuilder()
        .title("Memory usage percentage gauge")
        .description(
          "Current percentage of memory in use, based on available memory.",
        )
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTransformation(sortGaugesByHost)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - node_memory_MemAvailable_bytes{host!=""} / node_memory_MemTotal_bytes{host!=""})',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new BarGaugePanelBuilder()
        .title("CPU usage percentage")
        .description(
          "Average CPU usage percentage across all CPU cores, compared by host.",
        )
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTransformation(sortGaugesByHost)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - avg by (host) (rate(node_cpu_seconds_total{host!="",mode="idle"}[5m])))',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new PanelBuilder()
        .title("CPU usage percentage over time")
        .description(
          "Average CPU usage percentage across all CPU cores over time.",
        )
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("percent")
        .min(0)
        .max(100)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              '100 * (1 - avg by (host) (rate(node_cpu_seconds_total{host!="",mode="idle"}[5m])))',
            )
            .legendFormat("{{host}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new PanelBuilder()
        .title("Free filesystem bytes")
        .description("Free filesystem space reported by node-exporter.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("bytes")
        .min(0)
        .withTarget(
          new DataqueryBuilder()
            .expr('node_filesystem_free_bytes{host!="",mountpoint="/"}')
            .legendFormat("{{host}} {{mountpoint}}")
            .refId("A")
            .range(),
        ),
    )
    .withPanel(
      new StatPanelBuilder()
        .title("Loki logs received, last 24h")
        .description("Uncompressed log bytes received by Loki during the last 24 hours.")
        .height(4)
        .span(3)
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("bytes")
        .min(0)
        .graphMode("none")
        .withTarget(
          new DataqueryBuilder()
            .expr("sum(increase(loki_distributor_bytes_received_total[24h]))")
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new StatPanelBuilder()
        .title("Docker registry running")
        .description("Whether the Docker registry container is running.")
        .height(4)
        .span(3)
        .datasource({ type: "prometheus", uid: "prometheus" })
        .colorMode("background_solid")
        .graphMode("none")
        .mappings([
          {
            type: "value",
            options: {
              "0": { text: "Off" },
              "1": { text: "On" },
            },
          },
        ])
        .thresholds(healthyThresholds)
        .withTarget(
          new DataqueryBuilder()
            .expr("docker_registry_running or on() vector(0)")
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new StatPanelBuilder()
        .title("m-ai registry tags")
        .description("Number of image tags available in the m-ai Docker registry.")
        .height(4)
        .span(3)
        .datasource({ type: "prometheus", uid: "prometheus" })
        .colorMode("background_solid")
        .graphMode("none")
        .thresholds(healthyThresholds)
        .withTarget(
          new DataqueryBuilder()
            .expr(
              'docker_registry_tag_count{repository="m-ai"} or on() vector(0)',
            )
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new StatPanelBuilder()
        .title("World rows")
        .description("Current number of rows in the Postgres World table.")
        .height(4)
        .span(3)
        .datasource({ type: "postgres", uid: "postgres" })
        .unit("none")
        .min(0)
        .graphMode("none")
        .withTarget(worldRowsQuery),
    )
    .build();

const gameplayDashboard = () =>
  new DashboardBuilder("Gameplay")
    .uid("gameplay")
    .tags(["generated"])
    .refresh("30s")
    .time({ from: "now-1h", to: "now" })
    .timezone("browser")
    .withPanel(
      new BarGaugePanelBuilder()
        .title("Bot health")
        .description("Minecraft player health for each bot, ordered by bot name.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("none")
        .min(0)
        .max(20)
        .thresholds(playerHealthThresholds)
        .withTransformation(sortGaugesByBotName)
        .withTarget(
          new DataqueryBuilder()
            .expr("minecraft_user_health")
            .legendFormat("{{botName}}")
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new BarGaugePanelBuilder()
        .title("Bot idle")
        .description("Whether each bot has no active goal, ordered by bot name.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("none")
        .min(0)
        .max(1)
        .mappings([
          {
            type: "value",
            options: {
              "0": { text: "Active" },
              "1": { text: "Idle" },
            },
          },
        ])
        .thresholds(healthyThresholds)
        .withTransformation(sortGaugesByBotName)
        .withTarget(
          new DataqueryBuilder()
            .expr("minecraft_no_goal")
            .legendFormat("{{botName}}")
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new BarGaugePanelBuilder()
        .title("Bot hunger")
        .description("Minecraft food level for each bot, ordered by bot name.")
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("none")
        .min(0)
        .max(20)
        .thresholds(playerHealthThresholds)
        .withTransformation(sortGaugesByBotName)
        .withTarget(
          new DataqueryBuilder()
            .expr("minecraft_user_food")
            .legendFormat("{{botName}}")
            .refId("A")
            .instant(),
        ),
    )
    .withPanel(
      new StatPanelBuilder()
        .title("Online bots")
        .description("Bots currently reporting metrics through the daemon.")
        .height(4)
        .span(3)
        .datasource({ type: "prometheus", uid: "prometheus" })
        .unit("none")
        .min(0)
        .graphMode("none")
        .withTarget(
          new DataqueryBuilder()
            .expr("count(minecraft_service_health) or vector(0)")
            .refId("A")
            .instant(),
        ),
    )
    .build();

const main = async () => {
  await Promise.all([
    writeFile(
      "k8s/base/grafana-dashboard.json",
      `${JSON.stringify(filesystemDashboard(), null, 2)}\n`,
    ),
    writeFile(
      "k8s/base/gameplay-dashboard.json",
      `${JSON.stringify(gameplayDashboard(), null, 2)}\n`,
    ),
  ]);
};

main();
