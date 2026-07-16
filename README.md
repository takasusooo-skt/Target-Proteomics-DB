# Targeted Proteomics Catalog

共同研究者向けの公開静的カタログです。GitHub Pagesではリポジトリのサブパスから配信されるため、ページ内のCSS・JavaScript・データ参照は相対パスで構成しています。

タンパク質一覧では測定状態、Gene、Protein、Isoform、関連する経路・機能を確認できます。経路・機能詳細では経路図を上、その下にタンパク質一覧を表示します。選択したタンパク質は右上の選択一覧から確認し、JSON／CSVとして出力できます。

経路図は公開用に簡略化した表示です。出典は各経路ページに表示しています。

この公開DBが公開情報の大本です。公開出力は data/public_*.csv と data/catalog_data.js で、内部のAssay ManagerやSQLiteを公開DBとして扱いません。Assay Managerへは、これらの公開CSVを手動で一方向に同期します。公開側にはpeptide、transition、配列、RT、CE、Skyline、測定結果などの内部測定情報を出力しません。
