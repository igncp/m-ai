const printGrafanaDashboard = () => ({
  annotations: {
    list: [
      {
        builtIn: 1,
        datasource: {
          type: "grafana",
          uid: "-- Grafana --",
        },
        enable: true,
        hide: true,
        iconColor: "rgba(0, 211, 255, 1)",
        name: "Annotations & Alerts",
        type: "dashboard",
      },
    ],
  },
  editable: true,
  fiscalYearStartMonth: 0,
  graphTooltip: 0,
  id: 1,
  links: [],
  panels: [
    {
      datasource: {
        type: "prometheus",
        uid: "dex8dbwpe8utcb",
      },
      fieldConfig: {
        defaults: {
          color: {
            mode: "palette-classic",
          },
          custom: {
            axisBorderShow: false,
            axisCenteredZero: false,
            axisColorMode: "text",
            axisLabel: "",
            axisPlacement: "auto",
            barAlignment: 0,
            barWidthFactor: 0.6,
            drawStyle: "line",
            fillOpacity: 0,
            gradientMode: "none",
            hideFrom: {
              legend: false,
              tooltip: false,
              viz: false,
            },
            insertNulls: false,
            lineInterpolation: "linear",
            lineWidth: 1,
            pointSize: 5,
            scaleDistribution: {
              type: "linear",
            },
            showPoints: "auto",
            spanNulls: false,
            stacking: {
              group: "A",
              mode: "none",
            },
            thresholdsStyle: {
              mode: "off",
            },
          },
          mappings: [],
          thresholds: {
            mode: "absolute",
            steps: [
              {
                color: "green",
                value: 0,
              },
              {
                color: "red",
                value: 80,
              },
            ],
          },
        },
        overrides: [],
      },
      gridPos: {
        h: 8,
        w: 12,
        x: 0,
        y: 0,
      },
      id: 1,
      options: {
        legend: {
          calcs: [],
          displayMode: "list",
          placement: "bottom",
          showLegend: true,
        },
        tooltip: {
          hideZeros: false,
          mode: "single",
          sort: "none",
        },
      },
      pluginVersion: "12.1.1",
      targets: [
        {
          datasource: {
            type: "prometheus",
            uid: "dex8dbwpe8utcb",
          },
          disableTextWrap: false,
          editorMode: "builder",
          expr: "minecraft_user_health",
          fullMetaSearch: false,
          includeNullMetadata: true,
          legendFormat: "__auto",
          range: true,
          refId: "A",
          useBackend: false,
        },
      ],
      title: "New panel",
      type: "timeseries",
    },
  ],
  preload: false,
  refresh: "",
  schemaVersion: 41,
  tags: [],
  templating: {
    list: [],
  },
  time: {
    from: "now-5m",
    to: "now",
  },
  timepicker: {},
  timezone: "",
  title: "Main",
  uid: "1e6ca687-d304-4f4b-be7a-3f167f4b44f8",
  version: 2,
});

export { printGrafanaDashboard };
