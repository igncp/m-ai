import { writeFile } from "node:fs/promises";

import { PanelBuilder as BarGaugePanelBuilder } from "@grafana/grafana-foundation-sdk/bargauge";
import { DashboardBuilder } from "@grafana/grafana-foundation-sdk/dashboard";
import { PanelBuilder as GaugePanelBuilder } from "@grafana/grafana-foundation-sdk/gauge";
import { DataqueryBuilder } from "@grafana/grafana-foundation-sdk/prometheus";
import { PanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";

const sortGaugesByHost = {
  id: "sortBy",
  options: {
    fields: {
      host: false,
    },
  },
};

const dashboard = () =>
  new DashboardBuilder("Node filesystem")
    .uid("node-filesystem")
    .tags(["generated"])
    .refresh("30s")
    .time({ from: "now-1h", to: "now" })
    .timezone("browser")
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
    .build();

const main = async () => {
  await writeFile(
    "k8s/base/grafana-dashboard.json",
    `${JSON.stringify(dashboard(), null, 2)}\n`,
  );
};

main();
