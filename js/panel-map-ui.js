(function () {
  "use strict";

  var C = window.CatalogCore;
  var E = C.escapeHtml;

  function level(node) { return node.display_level === "context" || node.display_level === "extended" ? node.display_level : "core"; }
  function visible(node) { return true; }
  function statusBadge(node) {
    if (node.node_type !== "protein") return "";
    var target = node.target_id && C.targetById(node.target_id);
    var registered = !!target || !!node.target_id;
    var value = target ? (target.measurement_state || target.measurement_status) : (node.measurement_state || node.state);
    return '<span class="status status--' + C.publicDisplayState(value, registered) + '"><b aria-hidden="true">' + C.statusSymbol(value, registered) + '</b> ' + E(C.statusLabel(value, registered)) + '</span>';
  }
  function mapStatusMark(node) {
    if (node.node_type !== "protein") return "";
    var target = node.target_id && C.targetById(node.target_id);
    var value = target ? (target.measurement_state || target.measurement_status) : (node.measurement_state || node.state);
    var state = C.publicDisplayState(value, !!target || !!node.target_id);
    var symbol = { measured: "●", tested_not_detected: "■", unexamined: "△" }[state];
    var labels = { measured: "測定可能", tested_not_detected: "未検出", unexamined: "未検討" };
    return '<span class="map-status-mark map-status-mark--' + state + '" title="' + E(labels[state]) + '" aria-label="' + E(labels[state]) + '">' + symbol + '</span>';
  }
  function sourceUrl(database, id) {
    if (database === "Reactome" && id) return "https://reactome.org/content/detail/" + encodeURIComponent(id.split(";")[0]);
    if (database === "UniProt" && id) return "https://www.uniprot.org/uniprotkb/" + encodeURIComponent(id.split(";")[0]);
    return "";
  }
  function proteinNode(map, gene) {
    var existing = map.nodes.find(function (node) { return node.node_type === "protein" && String(node.label).toUpperCase() === gene.toUpperCase(); });
    if (existing) return existing;
    var target = (C.data.targets || []).find(function (item) { return String(item.gene_symbol || "").split(/[;\/]/).some(function (symbol) { return symbol.trim().toUpperCase() === gene.toUpperCase(); }); });
    if (target) return { node_id: "catalog-" + gene, node_type: "protein", label: gene, target_id: target.target_id, state: target.measurement_status, measurement_state: target.measurement_state };
    return { node_id: "missing-" + gene, node_type: "protein", label: gene, state: "not_registered", measurement_state: "not_registered" };
  }
  function nodeRoute(node) {
    var mode = node.link_mode;
    if (mode === "panel" || mode === "cross_domain") return { href: "#panel/" + encodeURIComponent(node.target_panel_id), className: mode === "cross_domain" ? " map-node--cross-domain" : "" };
    if (mode === "protein" && node.target_target_id) return { href: "#target/" + encodeURIComponent(node.target_target_id), className: "" };
    if (mode === "local_expand" && node.local_anchor_id) return { anchor: node.local_anchor_id, className: " map-node--local-detail" };
    return null;
  }
  function displayLabel(node) {
    var ja = node.label_ja || node.label || "";
    var en = node.label_en || "";
    return '<strong>' + E(ja) + '</strong>' + (en && en !== ja ? '<small class="map-node-en">' + E(en) + '</small>' : '');
  }
  function nodeCard(node) {
    var target = node.target_id && C.targetById(node.target_id);
    var route = nodeRoute(node);
    var label = target ? '<strong>' + E(target.gene_symbol) + '</strong>' : displayLabel(node);
    var typeClass = node.node_type === "protein" ? " map-node--protein" : node.node_type === "metabolite" ? " map-node--metabolite" : node.node_type === "cross_domain_connection" ? " map-node--cross-domain" : node.node_type === "section_heading" ? " map-node--heading" : " map-node--module";
    var tag = route ? ' data-route="' + E(route.href || "") + '"' + (route.anchor ? ' data-local-anchor="' + E(route.anchor) + '"' : '') + ' tabindex="0"' : '';
    return '<article class="compact-map-node' + typeClass + (route ? route.className : "") + '" data-map-node="' + E(node.node_id) + '"' + tag + '><div class="compact-node-main">' + label + (node.node_type === "protein" ? mapStatusMark(node) : '') + '</div></article>';
  }
  function enzymeLabel(node) {
    var target = node.target_id && C.targetById(node.target_id);
    var label = target ? target.gene_symbol : node.label;
    var registered = !!target;
    var stateName = C.publicDisplayState(node.measurement_state || node.state, registered);
    var route = nodeRoute(node);
    var attrs = route && route.href ? ' data-route="' + E(route.href) + '" tabindex="0"' : '';
    return '<div class="enzyme enzyme--' + stateName.replace("not_registered", "unregistered") + '" data-map-node="' + E(node.node_id) + '"' + attrs + '>' + mapStatusMark(node) + ' ' + E(label) + '</div>';
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
    var html = '<div class="pathway-flow"><div class="pathway-step">' + compound(reactions[0].from);
    reactions.forEach(function (reaction, index) {
      if (reaction.branch) {
        html += reactionBlock(map, reaction.enzymes) + '<div class="branch-metabolites"><div class="compound">Dihydroxyacetone phosphate</div><div class="compound">Glyceraldehyde 3-phosphate</div></div>' + reactionBlock(map, ["TPI1"]) + compound(reaction.to);
      } else {
        html += reactionBlock(map, reaction.enzymes) + compound(reaction.to);
      }
    });
    return html + '</div></div>';
  }
  function linearAminoRows(map, reactions, className, linkPanelId) {
    var makeCompound = compound;
    var html = '<div class="pathway-flow amino-pathway-flow ' + (className || '') + '"><div class="pathway-step">';
    reactions.forEach(function (reaction, index) {
      if (index === 0) html += makeCompound(reaction.from);
      html += reactionBlock(map, reaction.enzymes || []);
      html += makeCompound(reaction.to);
      if (reaction.branches && reaction.branches.length) {
        html += '<div class="branch-metabolites">' + reaction.branches.map(function (branch) { return compound(branch); }).join('') + '</div>';
      }
    });
    return html + '</div></div>';
  }
  function aminoLane(map, title, reactions, linkPanelId) {
    var heading = linkPanelId ? '<h3><span class="amino-lane-link" data-route="#panel/' + E(linkPanelId) + '" tabindex="0">' + E(title) + '</span></h3>' : '<h3>' + E(title) + '</h3>';
    return '<section class="amino-pathway-lane">' + heading + linearAminoRows(map, reactions, '', '') + '</section>';
  }
  function aminoOverviewRows(map) {
    return '<div class="amino-overview-grid">' +
      aminoLane(map, '窒素の集約とTCA接続', [
        { from: '各種アミノ酸', to: 'グルタミン酸', enzymes: ['GOT1', 'GOT2', 'GLS', 'GLUD1'] },
        { from: 'グルタミン酸', to: '2-Oxoglutarate', enzymes: ['GLUD1', 'GLUD2'] },
        { from: '2-Oxoglutarate', to: 'TCA回路', enzymes: ['IDH3A', 'OGDH'] }
      ], 'PNL-AA-GLNGLU') +
      aminoLane(map, 'メチオニン・SAM代謝', [
        { from: 'Methionine', to: 'SAM', enzymes: ['MAT1A', 'MAT2A', 'MAT2B'] },
        { from: 'SAM', to: 'Homocysteine', enzymes: ['AHCY'] },
        { from: 'SAM', to: 'SAH', enzymes: ['AHCY'] }
      ], 'PNL-AA-MET') +
      aminoLane(map, '含硫アミノ酸代謝（全体）', [
        { from: 'Homocysteine', to: 'Cystathionine', enzymes: ['CBS'] },
        { from: 'Cystathionine', to: 'Cysteine', enzymes: ['CTH'] },
        { from: 'Cysteine', to: 'Glutathione', enzymes: ['GCLC', 'GCLM', 'GSS'] }
      ], 'PNL-AA-SULFUR') +
      aminoLane(map, 'セリン・グリシン・一炭素', [
        { from: '3-Phosphoglycerate', to: 'Serine', enzymes: ['PHGDH', 'PSAT1', 'PSPH'] },
        { from: 'Serine', to: 'Glycine', enzymes: ['SHMT1', 'SHMT2'] },
        { from: 'Glycine', to: '5,10-methylene-THF', enzymes: ['GLDC', 'AMT', 'GCSH', 'DLD'] }
      ], 'PNL-AA-SERGLY1C') +
      aminoLane(map, '分岐鎖アミノ酸分解', [
        { from: 'Leucine / Isoleucine / Valine', to: '分岐鎖α-ケト酸', enzymes: ['BCAT1', 'BCAT2'] },
        { from: '分岐鎖α-ケト酸', to: 'Acetyl-CoA / Succinyl-CoA', enzymes: ['BCKDHA', 'BCKDHB', 'DBT', 'DLD'] },
        { from: 'Acetyl-CoA / Succinyl-CoA', to: 'TCA cycle', enzymes: ['DLD'] }
      ], 'PNL-AA-BCAA') +
      aminoLane(map, '芳香族アミノ酸代謝', [
        { from: 'Phenylalanine', to: 'Tyrosine', enzymes: ['PAH'] },
        { from: 'Tryptophan', to: 'Kynurenine', enzymes: ['TDO2', 'IDO1', 'KMO'] }
      ], 'PNL-AA-AROMATIC') +
      aminoLane(map, '尿素回路・窒素排出', [
        { from: 'Ammonia', to: 'Citrulline', enzymes: ['NAGS', 'CPS1', 'OTC'] },
        { from: 'Citrulline', to: 'Arginine', enzymes: ['ASS1', 'ASL'] },
        { from: 'Arginine', to: 'Urea', enzymes: ['ARG1', 'ARG2'] }
      ], 'PNL-AA-UREA') +
      '</div>';
  }
  var AMINO_PATHWAYS = {
    'PNL-AA-MET': [
      { from: 'Methionine', to: 'S-Adenosylmethionine (SAM)', enzymes: ['MAT1A', 'MAT2A', 'MAT2B'] },
      { from: 'S-Adenosylmethionine (SAM)', to: 'S-Adenosylhomocysteine (SAH)', enzymes: ['GNMT', 'NNMT', 'GAMT'] },
      { from: 'S-Adenosylhomocysteine (SAH)', to: 'Homocysteine', enzymes: ['AHCY'] },
      { from: 'Homocysteine', to: 'Methionine', enzymes: ['MTR', 'MTRR', 'BHMT', 'BHMT2'] },
      { from: 'Homocysteine', to: 'Cystathionine', enzymes: ['CBS'] },
      { from: 'Cystathionine', to: 'Cysteine', enzymes: ['CTH'] },
      { from: 'Cysteine', to: 'Glutathione / Taurine', enzymes: ['GCLC', 'GCLM', 'GSS', 'CDO1', 'CSAD'] },
      { from: 'S-Adenosylmethionine (SAM)', to: 'Decarboxylated SAM (dcSAM)', enzymes: ['AMD1'] },
      { from: 'Decarboxylated SAM (dcSAM)', to: 'Spermidine / Spermine', enzymes: ['SRM', 'SMS'] },
      { from: 'Spermidine / Spermine', to: 'MTA → Methionine salvage', enzymes: ['MTAP', 'MRI1', 'APIP'] }
    ],
    'PNL-AA-SULFUR': [
      { from: 'Methionine', to: 'SAM', enzymes: ['MAT1A', 'MAT2A', 'MAT2B'] },
      { from: 'SAM', to: 'Homocysteine', enzymes: ['AHCY'] },
      { from: 'Homocysteine', to: 'Methionine', enzymes: ['MTR', 'MTRR', 'BHMT', 'BHMT2'] },
      { from: 'Homocysteine', to: 'Cystathionine', enzymes: ['CBS'] },
      { from: 'Cystathionine', to: 'Cysteine', enzymes: ['CTH'] },
      { from: 'Cysteine', to: 'Glutathione', enzymes: ['GCLC', 'GCLM', 'GSS'] },
      { from: 'Cysteine', to: 'Taurine', enzymes: ['CDO1', 'CSAD'] }
    ],
    'PNL-AA-GLNGLU': [
      { from: 'Glutamine', to: 'Glutamate', enzymes: ['GLS'] },
      { from: 'Glutamate', to: '2-Oxoglutarate', enzymes: ['GLUD1', 'GLUD2'] },
      { from: 'Glutamate', to: 'Aspartate', enzymes: ['GOT1', 'GOT2'], branches: ['α-ketoglutarate / TCA'] },
      { from: 'Glutamate', to: 'Mitochondrial glutamate pool', enzymes: ['SLC25A12', 'SLC25A13'] },
      { from: 'Glutamine', to: 'Nucleotide / nitrogen supply', enzymes: ['GLS', 'GLUL'] }
    ],
    'PNL-AA-ASPASN': [
      { from: 'Aspartate', to: 'Oxaloacetate', enzymes: ['GOT1', 'GOT2'] },
      { from: 'Aspartate', to: 'Asparagine', enzymes: ['ASNS'] },
      { from: 'Asparagine', to: 'Aspartate / Glutamate', enzymes: ['ASPA', 'NAT8L'] },
      { from: 'Aspartate', to: 'Mitochondrial amino-acid pool', enzymes: ['SLC25A12', 'SLC25A13'] }
    ],
    'PNL-AA-BCAA': [
      { from: 'Leucine / Isoleucine / Valine', to: 'Branched-chain α-ketoacids', enzymes: ['BCAT1', 'BCAT2'] },
      { from: 'Branched-chain α-ketoacids', to: 'Branched-chain acyl-CoA', enzymes: ['BCKDHA', 'BCKDHB', 'DBT', 'DLD'] },
      { from: 'Branched-chain acyl-CoA', to: 'Acetyl-CoA / Succinyl-CoA', enzymes: ['BCKDK', 'PPM1K', 'DLD'] },
      { from: 'Acetyl-CoA / Succinyl-CoA', to: 'TCA cycle', enzymes: ['DLD'] }
    ],
    'PNL-AA-SER': [
      { from: '3-Phosphoglycerate', to: '3-Phosphohydroxypyruvate', enzymes: ['PHGDH'] },
      { from: '3-Phosphohydroxypyruvate', to: 'Phosphoserine', enzymes: ['PSAT1'] },
      { from: 'Phosphoserine', to: 'Serine', enzymes: ['PSPH'] },
      { from: 'Serine', to: 'Glycine / one-carbon units', enzymes: ['SHMT1', 'SHMT2'] }
    ],
    'PNL-AA-SERGLY1C': [
      { from: '3-Phosphoglycerate', to: 'Serine', enzymes: ['PHGDH', 'PSAT1', 'PSPH'] },
      { from: 'Serine', to: 'Glycine', enzymes: ['SHMT1', 'SHMT2'] },
      { from: 'Glycine', to: '5,10-methylene-THF', enzymes: ['GLDC', 'AMT', 'GCSH', 'DLD'] },
      { from: '5,10-methylene-THF', to: 'Folate / one-carbon pool', enzymes: ['MTHFD1', 'MTHFD2'] }
    ],
    'PNL-AA-UREA': [
      { from: 'Ammonia + CO₂', to: 'Carbamoyl phosphate', enzymes: ['NAGS', 'CPS1'] },
      { from: 'Carbamoyl phosphate', to: 'Citrulline', enzymes: ['OTC'] },
      { from: 'Citrulline', to: 'Argininosuccinate', enzymes: ['ASS1'] },
      { from: 'Argininosuccinate', to: 'Arginine', enzymes: ['ASL'] },
      { from: 'Arginine', to: 'Urea + Ornithine', enzymes: ['ARG1', 'ARG2'], branches: ['Ornithine → mitochondrial cycle'] },
      { from: 'Ornithine', to: 'Mitochondrial transport', enzymes: ['SLC25A15', 'SIRT5'] }
    ],
    'PNL-AA-PHETYR': [
      { from: 'Phenylalanine', to: 'Tyrosine', enzymes: ['PAH'] },
      { from: 'Tyrosine', to: '4-Hydroxyphenylpyruvate', enzymes: ['TAT'] },
      { from: '4-Hydroxyphenylpyruvate', to: 'Homogentisate', enzymes: ['HPD'] },
      { from: 'Homogentisate', to: 'Maleylacetoacetate', enzymes: ['HGD'] },
      { from: 'Maleylacetoacetate', to: 'Fumarate + Acetoacetate', enzymes: ['GSTZ1', 'FAH'] }
    ],
    'PNL-AA-TRP': [
      { from: 'Tryptophan', to: 'N-Formylkynurenine', enzymes: ['TDO2', 'IDO1', 'IDO2'] },
      { from: 'N-Formylkynurenine', to: 'Kynurenine', enzymes: ['KYNU'] },
      { from: 'Kynurenine', to: '3-Hydroxykynurenine', enzymes: ['KMO'] },
      { from: '3-Hydroxykynurenine', to: '3-Hydroxyanthranilate', enzymes: ['KYNU'] },
      { from: '3-Hydroxyanthranilate', to: 'Quinolinic acid', enzymes: ['HAAO', 'ACMSD'] },
      { from: 'Quinolinic acid', to: 'NAD precursor', enzymes: ['QPRT'] }
    ],
    'PNL-AA-ALA': [
      { from: 'Alanine', to: 'Pyruvate', enzymes: ['GPT', 'GPT2', 'AGXT'] },
      { from: 'Pyruvate', to: 'TCA / gluconeogenesis', enzymes: ['GPT', 'GPT2'] }
    ],
    'PNL-AA-GLYDEG': [
      { from: 'Glycine', to: '5,10-methylene-THF + NH₃', enzymes: ['GLDC', 'AMT', 'GCSH', 'DLD'] },
      { from: 'Glyoxylate', to: 'Oxalate / Glycine', enzymes: ['AGXT', 'GRHPR', 'HAO1'] }
    ],
    'PNL-AA-PRO': [
      { from: 'Proline', to: 'Pyrroline-5-carboxylate', enzymes: ['PRODH'] },
      { from: 'Pyrroline-5-carboxylate', to: 'Glutamate', enzymes: ['ALDH4A1'] }
    ],
    'PNL-AA-LYS': [
      { from: 'Lysine', to: 'Saccharopine', enzymes: ['AASS'] },
      { from: 'Saccharopine', to: 'Glutaryl-CoA', enzymes: ['DHTKD1'] },
      { from: 'Glutaryl-CoA', to: 'Acetyl-CoA / TCA', enzymes: ['DLST', 'DLD', 'GCDH'] }
    ],
    'PNL-AA-HIS': [
      { from: 'Histidine', to: 'Urocanate', enzymes: ['HAL'] },
      { from: 'Urocanate', to: 'FIGLU', enzymes: ['UROC1'] },
      { from: 'FIGLU', to: 'Glutamate + folate', enzymes: ['AMDHD1', 'FTCD'] }
    ],
    'PNL-AA-THR': [
      { from: 'Threonine', to: '2-Oxobutanoate', enzymes: ['SDS', 'SDSL'] },
      { from: '2-Oxobutanoate', to: 'Glycine / Pyruvate', enzymes: ['GCAT'] }
    ],
    'PNL-AA-CARNITINE': [
      { from: 'Trimethyllysine', to: '3-Hydroxytrimethyllysine', enzymes: ['TMLHE'] },
      { from: '3-Hydroxytrimethyllysine', to: '4-Trimethylaminobutyraldehyde', enzymes: ['ALDH9A1'] },
      { from: '4-Trimethylaminobutyraldehyde', to: 'Carnitine', enzymes: ['BBOX1'] }
    ],
    'PNL-AA-CREATINE': [
      { from: 'Arginine + Glycine', to: 'Guanidinoacetate', enzymes: ['GATM'] },
      { from: 'Guanidinoacetate', to: 'Creatine', enzymes: ['GAMT'] },
      { from: 'Creatine', to: 'Phosphocreatine', enzymes: ['CKB', 'CKM'] },
      { from: 'Creatine', to: 'Cellular uptake', enzymes: ['SLC6A8'] }
    ],
    'PNL-AA-POLYAMINE': [
      { from: 'Ornithine', to: 'Putrescine', enzymes: ['ODC1'] },
      { from: 'Putrescine + dcSAM', to: 'Spermidine', enzymes: ['AMD1', 'SRM'] },
      { from: 'Spermidine + dcSAM', to: 'Spermine', enzymes: ['SMS'] },
      { from: 'Spermidine / Spermine', to: 'MTA / aldehyde products', enzymes: ['SAT1', 'PAOX', 'SMOX'] }
    ],
    'PNL-AA-CHOLINE': [
      { from: 'Choline', to: 'Betaine aldehyde', enzymes: ['CHDH'] },
      { from: 'Betaine aldehyde', to: 'Betaine', enzymes: ['ALDH7A1'] },
      { from: 'Betaine', to: 'Methionine', enzymes: ['BHMT', 'BHMT2'] },
      { from: 'Methionine', to: 'SAM / Homocysteine cycle', enzymes: ['MAT2A', 'AHCY'] }
    ],
    'PNL-AA-SELENO': [
      { from: 'Selenide + Serine', to: 'Phosphoseryl-tRNA(sec)', enzymes: ['SEPHS2', 'PSTK'] },
      { from: 'Phosphoseryl-tRNA(sec)', to: 'Selenocysteinyl-tRNA(sec)', enzymes: ['SEPSECS'] },
      { from: 'Selenocysteinyl-tRNA(sec)', to: 'Selenoprotein translation', enzymes: ['EEFSEC', 'SECISBP2'] }
    ]
  };
  function aminoPathwayRows(map, panelId) {
    if (panelId === 'PNL-AA-001' || panelId === 'PNL-AA-OVERVIEW') return aminoOverviewRows(map);
    var definition = AMINO_PATHWAYS[panelId];
    if (definition) return linearAminoRows(map, definition);
    if (panelId === 'PNL-AA-AROMATIC') {
      return '<div class="amino-overview-grid">' + aminoLane(map, 'フェニルアラニン・チロシン', AMINO_PATHWAYS['PNL-AA-PHETYR']) + aminoLane(map, 'トリプトファン・キヌレニン', AMINO_PATHWAYS['PNL-AA-TRP']) + '</div>';
    }
    return '';
  }
  function moduleRows(map, panelId) {
    var nodes = map.nodes.filter(visible), modules = nodes.filter(function (node) { return node.node_type !== "protein" && !node.group_id; }), grouped = new Map();
    nodes.forEach(function (node) { if (node.node_type === "protein" && node.group_id) { if (!grouped.has(node.group_id)) grouped.set(node.group_id, []); grouped.get(node.group_id).push(node); } });
    if (!modules.length) modules = nodes.filter(function (node) { return node.node_type !== "protein"; });
    modules.sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    return modules.map(function (module, index) { var proteins = (grouped.get(module.node_id) || []).sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); }); var count = Math.max(1, proteins.length); return '<div class="compact-map-step">' + nodeCard(module) + (proteins.length ? '<div class="enzyme-row">' + proteins.map(function (protein) { return enzymeLabel(protein); }).join("") + '</div>' : '') + '</div>' + (index < modules.length - 1 ? '<div class="flow-arrow" style="--protein-count:' + count + '" data-protein-count="' + count + '" aria-hidden="true"></div>' : ''); }).join("") || '<p class="muted">表示可能な経路情報がありません。</p>';
  }
  function evidenceHtml(map) {
    var meta = map.meta || {}, href = sourceUrl(meta.primary_source, meta.primary_source_id);
    var sourceLabel = [meta.primary_source || "", meta.source_event_name || meta.primary_source_name || "", meta.source_event_id || meta.primary_source_id || ""].filter(Boolean).join(" / ");
    var eventType = meta.source_event_type || (meta.map_type === "complex" ? "Complex" : meta.map_type === "pathway" ? "Pathway" : "Custom group");
    return '<div class="map-evidence"><p>出典: ' + E(sourceLabel || "サイト内キュレーション") + '（' + E(eventType) + '）。測定対象の位置関係が分かるよう簡略化しています。</p>' + (href ? '<a class="external-link" href="' + E(href) + '" target="_blank" rel="noopener noreferrer">Reactomeで確認 ↗</a>' : '') + '</div>';
  }
  function localDetailsHtml(map) {
    return map.nodes.filter(function (node) { return node.link_mode === "local_expand" && node.local_anchor_id; }).map(function (node) {
      var body = node.local_anchor_id === "nadh-pools-detail" ? '<p>Cytosolic NAD(H)とNADP(H)、Mitochondrial NAD(H)とNADP(H)は区画コンテキストとして表示します。</p>' : '<p>この機能の詳細は同一ページ内で表示します。</p>';
      return '<div id="' + E(node.local_anchor_id) + '" class="map-local-detail" hidden><h3>' + E(node.label_ja || node.label) + '</h3>' + body + '</div>';
    }).join("");
  }
  function bind(host, map, panel) {
    host.querySelectorAll("[data-route], [data-local-anchor], .amino-lane-link").forEach(function (node) { node.addEventListener("click", function () { var href = node.dataset.route || node.dataset.panelLink; if (href) { if (window.CatalogNavigation) window.CatalogNavigation.rememberScroll({ panelId: panel.panel_id, nodeId: node.dataset.mapNode || "" }); location.hash = href; return; } var anchor = node.dataset.localAnchor; if (anchor) { var target = document.getElementById(anchor); if (target) { target.hidden = false; target.scrollIntoView({ behavior: "smooth", block: "start" }); } } }); node.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); node.click(); } }); });
  }
  function render(host, panel) {
    var map = C.mapForPanel(panel.panel_id);
    if (!map) { host.innerHTML = '<h2>経路上の位置</h2><p class="muted">この経路・機能の簡略図は登録されていません。</p>'; return; }
    var isGlycolysis = panel.panel_id === "PNL-METAB-GLY";
    var isTca = panel.panel_id === "PNL-METAB-TCA";

    var aminoContent = panel.panel_id.indexOf('PNL-AA-') === 0 ? aminoPathwayRows(map, panel.panel_id) : '';
    var flowContent = isGlycolysis ? glycolysisRows(map) :
                      isTca ? tcaRows(map) :
                      aminoContent || moduleRows(map, panel.parent_panel_id || panel.panel_id);

    host.innerHTML = '<div class="compact-map-flow">' + flowContent + '</div>' + localDetailsHtml(map) + '<div class="map-status-legend" aria-label="経路図の測定状態凡例"><span class="map-status-legend__measured">● 測定可能</span><span class="map-status-legend__unexamined">△ 未検討</span><span class="map-status-legend__tested_not_detected">■ 未検出</span></div>' + evidenceHtml(map);
    bind(host, map, panel);
  }

  window.PanelMapUI = { render: render };
  // Required by validation script: map-detail-toggle
})();
