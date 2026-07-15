(function () {
  "use strict";

  var C = window.CatalogCore;
  var E = C.escapeHtml;
  var state = { detail: false };

  function level(node) { return node.display_level === "context" || node.display_level === "extended" ? node.display_level : "core"; }
  function visible(node) { var value = level(node); return value === "core" || state.detail; }
  function statusBadge(node) {
    if (node.node_type !== "protein") return "";
    var registered = !!node.target_id;
    return '<span class="status status--' + C.publicState(node.measurement_state || node.state, registered).replace("not_registered", "unregistered") + '"><b aria-hidden="true">' + C.statusSymbol(node.measurement_state || node.state, registered) + '</b> ' + E(C.statusLabel(node.measurement_state || node.state, registered)) + '</span>';
  }
  function mapStatusMark(node) {
    if (node.node_type !== "protein") return "";
    var state = C.publicState(node.measurement_state || node.state, !!node.target_id);
    var symbol = { measured: "●", candidate: "▲", not_registered: "□" }[state];
    return '<span class="map-status-mark map-status-mark--' + state.replace("not_registered", "unregistered") + '" title="' + E({ measured: "実績あり", candidate: "候補", not_registered: "例無し" }[state]) + '" aria-label="' + E({ measured: "実績あり", candidate: "候補", not_registered: "例無し" }[state]) + '">' + symbol + '</span>';
  }
  function sourceUrl(database, id) {
    if (database === "Reactome" && id) return "https://reactome.org/content/detail/" + encodeURIComponent(id.split(";")[0]);
    if (database === "UniProt" && id) return "https://www.uniprot.org/uniprotkb/" + encodeURIComponent(id.split(";")[0]);
    return "";
  }
  function proteinNode(map, gene) { return map.nodes.find(function (node) { return node.node_type === "protein" && String(node.label).toUpperCase() === gene.toUpperCase(); }) || { node_id: "missing-" + gene, node_type: "protein", label: gene, state: "not_registered", measurement_state: "not_registered" }; }
  function panelIdForNode(node, fallback) {
    var panels = (C.data && C.data.panels) || [];
    var keys = [node.module, node.label].filter(function (value) { return value; }).map(function (value) { return String(value).trim(); });
    var exact = panels.find(function (item) { return keys.indexOf(item.panel_id) !== -1; });
    if (exact) return exact.panel_id;
    var matched = panels.find(function (item) {
      var names = [item.display_name_ja, item.short_name, item.panel_name].filter(function (value) { return value; }).map(function (value) { return String(value).trim(); });
      return names.some(function (name) { return keys.some(function (key) { return key === name || key.indexOf(name + ":") === 0 || key.indexOf(name + " ") === 0; }); });
    });
    return matched ? matched.panel_id : "";
  }
  function nodeCard(node, panelId) {
    var target = node.target_id && C.targetById(node.target_id);
    var label = target ? target.gene_symbol : node.label;
    var linkedPanelId = panelIdForNode(node, panelId);
    var panelLink = node.node_type !== "protein" && linkedPanelId ? "#panel/" + encodeURIComponent(linkedPanelId) : "";
    var typeClass = node.node_type === "protein" ? " map-node--protein" : node.node_type === "metabolite" ? " map-node--metabolite" : " map-node--module";
    return '<article class="compact-map-node' + typeClass + '" data-map-node="' + E(node.node_id) + '" data-target-id="' + E(target ? target.target_id : (node.node_type === "protein" ? "virtual/" + node.node_id : "")) + '" data-panel-link="' + E(panelLink) + '" tabindex="0"><div class="compact-node-main"><strong>' + E(label) + '</strong>' + mapStatusMark(node) + '</div></article>';
  }
  function enzymeLabel(node) {
    var target = node.target_id && C.targetById(node.target_id);
    var label = target ? target.gene_symbol : node.label;
    var registered = !!target;
    var stateName = C.publicState(node.measurement_state || node.state, registered);
    return '<div class="enzyme enzyme--' + stateName.replace("not_registered", "unregistered") + '" data-map-node="' + E(node.node_id) + '" data-target-id="' + E(target ? target.target_id : "virtual/" + node.node_id) + '" tabindex="0">' + mapStatusMark(node) + ' ' + E(label) + '</div>';
  }
  function reactionBlock(map, genes) {
    var count = Math.max(1, genes.length);
    return '<div class="reaction-block reaction-block--n' + count + '" style="--enzyme-count:' + count + '" data-enzyme-count="' + count + '"><div class="arrow-line" aria-hidden="true"></div><div class="enzyme-list">' + genes.map(function (gene) { return enzymeLabel(proteinNode(map, gene)); }).join("") + '</div></div>';
  }
  function compound(label) {
    return '<div class="compound">' + E(label) + '</div>';
  }
  function tcaRows(map) {
    var reactions = [
      { from: "Oxaloacetate + Acetyl-CoA", to: "Citrate", enzymes: ["CS"] },
      { from: "Citrate", to: "Isocitrate", enzymes: ["ACO2"] },
      { from: "Isocitrate", to: "2-Oxoglutarate", enzymes: ["IDH3A", "IDH3B", "IDH3G"] },
      { from: "2-Oxoglutarate", to: "Succinyl-CoA", enzymes: ["OGDH", "DLST", "DLD"] },
      { from: "Succinyl-CoA", to: "Succinate", enzymes: ["SUCLG1", "SUCLA2", "SUCLG2"] },
      { from: "Succinate", to: "Fumarate", enzymes: ["SDHA", "SDHB", "SDHC", "SDHD"] },
      { from: "Fumarate", to: "Malate", enzymes: ["FH"] },
      { from: "Malate", to: "Oxaloacetate", enzymes: ["MDH2"] }
    ];
    var html = '<div class="pathway-flow pathway-flow--cycle"><div class="pathway-step">' + compound(reactions[0].from);
    reactions.forEach(function (reaction) { html += reactionBlock(map, reaction.enzymes) + compound(reaction.to); });
    return html + '<div class="cycle-return" aria-label="Oxaloacetateから最初の反応へ戻る循環">↺ Oxaloacetateへ戻る</div></div></div>';
  }
  function glycolysisRows(map) {
    var pathway = {
      metabolites: ["Glucose", "Glucose 6-phosphate", "Fructose 6-phosphate", "Fructose 1,6-bisphosphate", "Dihydroxyacetone phosphate", "Glyceraldehyde 3-phosphate", "1,3-Bisphosphoglycerate", "3-Phosphoglycerate", "2-Phosphoglycerate", "Phosphoenolpyruvate", "Pyruvate"],
      reactions: [
      { from: "Glucose", to: "Glucose 6-phosphate", enzymes: ["HK1", "HK2"] },
      { from: "Glucose 6-phosphate", to: "Fructose 6-phosphate", enzymes: ["GPI"] },
      { from: "Fructose 6-phosphate", to: "Fructose 1,6-bisphosphate", enzymes: ["PFKM", "PFKL", "PFKP"] },
      { from: "Fructose 1,6-bisphosphate", to: "Glyceraldehyde 3-phosphate", enzymes: ["ALDOA"], branch: true },
      { from: "Glyceraldehyde 3-phosphate", to: "1,3-Bisphosphoglycerate", enzymes: ["GAPDH"] },
      { from: "1,3-Bisphosphoglycerate", to: "3-Phosphoglycerate", enzymes: ["PGK1"] },
      { from: "3-Phosphoglycerate", to: "2-Phosphoglycerate", enzymes: ["PGAM1"] },
      { from: "2-Phosphoglycerate", to: "Phosphoenolpyruvate", enzymes: ["ENO1"] },
      { from: "Phosphoenolpyruvate", to: "Pyruvate", enzymes: ["PKM"] }
      ]
    };
    var reactions = pathway.reactions;
    var html = '<div class="pathway-flow"><div class="pathway-step">';
    if (state.detail) html += compound("Glucose transport") + reactionBlock(map, ["SLC2A1"]) + compound("Glucose");
    else html += compound(reactions[0].from);
    reactions.forEach(function (reaction, index) {
      if (reaction.branch) {
        html += reactionBlock(map, reaction.enzymes) + '<div class="branch-metabolites"><div class="compound">Dihydroxyacetone phosphate</div><div class="compound">Glyceraldehyde 3-phosphate</div></div>' + reactionBlock(map, ["TPI1"]) + compound(reaction.to);
      } else {
        html += reactionBlock(map, reaction.enzymes) + compound(reaction.to);
      }
    });
    return html + '</div></div>';
  }
  function moduleRows(map, panelId) {
    var nodes = map.nodes.filter(visible), modules = nodes.filter(function (node) { return node.node_type !== "protein" && node.node_type !== "metabolite" && !node.group_id; }), grouped = new Map();
    nodes.forEach(function (node) { if (node.node_type === "protein" && node.group_id) { if (!grouped.has(node.group_id)) grouped.set(node.group_id, []); grouped.get(node.group_id).push(node); } });
    if (!modules.length) modules = nodes.filter(function (node) { return node.node_type !== "protein"; });
    modules.sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    return modules.map(function (module, index) { var proteins = (grouped.get(module.node_id) || []).sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); }); var count = Math.max(1, proteins.length); return '<div class="compact-map-step">' + nodeCard(module, panelId) + (proteins.length ? '<div class="enzyme-row">' + proteins.map(function (protein) { return enzymeLabel(protein); }).join("") + '</div>' : '') + '</div>' + (index < modules.length - 1 ? '<div class="flow-arrow" style="--protein-count:' + count + '" data-protein-count="' + count + '" aria-hidden="true"></div>' : ''); }).join("") || '<p class="muted">表示可能な経路情報がありません。</p>';
  }
  function evidenceHtml(map) {
    var meta = map.meta || {}, href = sourceUrl(meta.primary_source, meta.primary_source_id);
    var sourceLabel = [meta.primary_source || "", meta.source_event_name || meta.primary_source_name || "", meta.source_event_id || meta.primary_source_id || ""].filter(Boolean).join(" / ");
    var eventType = meta.source_event_type || (meta.map_type === "complex" ? "Complex" : meta.map_type === "pathway" ? "Pathway" : "Custom group");
    return '<div class="map-evidence"><p>出典: ' + E(sourceLabel || "サイト内キュレーション") + '（' + E(eventType) + '）。測定対象の位置関係が分かるよう簡略化しています。</p>' + (href ? '<a class="external-link" href="' + E(href) + '" target="_blank" rel="noopener noreferrer">Reactomeで確認 ↗</a>' : '') + '</div>';
  }
  function bind(host, map, panel) {
    host.querySelectorAll("[data-map-node]").forEach(function (node) { node.addEventListener("click", function () { if (node.dataset.panelLink) { location.hash = node.dataset.panelLink; return; } if (node.dataset.targetId) location.hash = "#target/" + encodeURIComponent(node.dataset.targetId); }); node.addEventListener("keydown", function (event) { if (event.key === "Enter") node.click(); }); });
    var detail = host.querySelector("[data-map-detail]");
    if (detail) detail.addEventListener("click", function () { state.detail = !state.detail; render(host, panel); });
  }
  function render(host, panel) {
    var map = C.mapForPanel(panel.panel_id);
    if (!map) { host.innerHTML = '<h2>経路上の位置</h2><p class="muted">この経路・機能の簡略図は登録されていません。</p>'; return; }
    var hasDetail = map.nodes.some(function (node) { return level(node) !== "core"; });
    var isGlycolysis = panel.panel_id === "PNL-METAB-GLY";
    var isTca = panel.panel_id === "PNL-METAB-TCA";
    var controls = hasDetail ? '<div class="map-controls"><button type="button" class="map-detail-toggle" data-map-detail>' + (state.detail ? "簡易表示に戻す" : "詳しく表示") + '</button></div>' : '';
    host.innerHTML = '<div class="map-heading"><div><p>代謝経路は化合物を主線、タンパク質を反応横のラベルとして表示しています。</p></div></div>' + controls + '<div class="compact-map-flow">' + (isGlycolysis ? glycolysisRows(map) : isTca ? tcaRows(map) : moduleRows(map, panel.parent_panel_id || panel.panel_id)) + '</div><div class="map-status-legend" aria-label="経路図の測定状態凡例"><span class="map-status-legend__measured">● 実績あり</span><span class="map-status-legend__candidate">▲ 候補</span><span class="map-status-legend__unregistered">□ 例無し</span></div>' + evidenceHtml(map);
    bind(host, map, panel);
  }
  window.PanelMapUI = { render: render };
})();
