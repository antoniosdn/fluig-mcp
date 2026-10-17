# Procedência do vendor `fluiggers-3.0.1`

Recorte da extensão **Fluiggers para VS Code 3.0.1** (`fluiggers.fluiggers-fluig-vscode-extension`, Marketplace), licença MIT, © 2020 Bruno Gasparetto (ver `LICENSE.txt`). Repositório: https://github.com/fluiggers/fluig-vscode-extension (não existe tag `3.0.1`; a cópia vem do pacote instalado).

Data da cópia: 17/10/2026.

## Arquivos de origem (extensão instalada)

| Arquivo | SHA-256 |
|---|---|
| `dist/extension.js` | `c0f603b9333648d15fcf59006652610e3bad00c22d2bb5f19d0abdd4bba25eb6` |
| `LICENSE.txt` | `b005b4fd5dd5ac763957273c72b04efc4e7eb6d657893d7f99309c8ae0a0102d` |
| `runtime/bpmn/creation-template.process.gz.b64` | `14ded7b88e745e70c877c6fab0ecc9c4076cb55aa80a4ae8e1ac4c025fe2e9c6` |

## Arquivos deste vendor

| Arquivo | SHA-256 |
|---|---|
| `LICENSE.txt` | `b005b4fd5dd5ac763957273c72b04efc4e7eb6d657893d7f99309c8ae0a0102d` |
| `creation-template.process.gz.b64` | `14ded7b88e745e70c877c6fab0ecc9c4076cb55aa80a4ae8e1ac4c025fe2e9c6` |
| `modulos.cjs` | `da680ff36d5e530025467e158e63cbd20516c92f7026b6b836524fd765dcc5d4` |

## Recorte

Raízes: `51077` (editor), `80072` (esqueleto), `46377` (parse), `41558` (validação), `71939` (gateway/atribuição), `15201` (SVG). O fechamento por `require` interno resulta em 29 módulos webpack, com um único externo: `require("node:path")` (módulo `76760`). Nenhum usa `vscode`.

Cada módulo é o texto exato do bundle. Offset em bytes (UTF-8) dentro de `dist/extension.js`.

| Id | Offset | Bytes | SHA-256 |
|---|---|---|---|
| `496` | 1972997 | 3350 | `ef19acf14fe95a5adc6f47b7dbe14e80a10e8dc6c7263c9d109d7c39f5c71553` |
| `15201` | 1789984 | 9103 | `9bf25b914da9f434e21de45978ed99c0db17966a56a3c051a9168c3d0955cd05` |
| `21427` | 1799088 | 723 | `3bd2d782fca57ad78e3d14800bf8b85ba05cae9b2cd5b2c5da8d25c1c44986d4` |
| `23776` | 1778899 | 4853 | `973b9ef8bde93017c9b9e0fead886016af418c54506c93719f584f5eed551530` |
| `33180` | 1788550 | 1433 | `185149fe4c39767a424608967a344f0268f3e43702958bf0dc7ab2aaddba3f12` |
| `33496` | 1993817 | 13170 | `77c70728bb8adad5a4c31cd8bc5b914494327c6f37e234781eb2208190f254e5` |
| `40452` | 1979309 | 1238 | `b2915ea85aef8c66144868a23614e5c41f7a42ada8081fee3e5384e10dd25f69` |
| `41558` | 1934023 | 4703 | `eae29059fa81d6d97d23ce648f89920f1232e33a8ca867614c0328e60f92b77a` |
| `42278` | 1976348 | 2960 | `6028ed347811e8be23f9f6fda3acada325e36bed6b83ff059ccd89cdd62ac078` |
| `46013` | 1986253 | 1298 | `78bc30855764778721aece635003da4f19dac28ef0177895f1b3958635fc24d3` |
| `46377` | 1799812 | 5547 | `01f8a6e34e941e02ce32a82f3fc79ada7b837f1122f52f82dd4e44a777bebd24` |
| `47337` | 1988137 | 4138 | `d8291014f3ea0547d5e25fdec4e65c3991b26076303284aec8c9c2879d82babe` |
| `51077` | 1805360 | 125943 | `289c2b7c471004efb11d0dcd96d6004c67c16d663cb2631a23ce0a6a5afac26e` |
| `53531` | 1736480 | 6465 | `d6027542aef3747a48193e660b994f73a48da7363e3d9e6730a1c7deda68ceda` |
| `54683` | 1743187 | 4973 | `6091b35e01e17f3f76f2b15b8a4fdf511e84ad9b4dc2a0bdb1373a47a382eda4` |
| `57862` | 86 | 7131 | `a46fa05ce73c4a616dce76c60b0c0db1baba42ded3dd9bc73728ca46d6ad99cf` |
| `60314` | 1967830 | 4172 | `f109f46c1e87cbd0fa1fdc0b274f660a8c8ef7aab659a16ff2d3162b18bf38de` |
| `60919` | 1733944 | 2535 | `fc8e9df07673f92c3b4e76cf72a1bae3c8d967eb0c0d0522ac5505b502612430` |
| `67353` | 1773406 | 5492 | `5e43b063edde4844b36068aaefd686d173894ffb227c3c531fec79e6c93b1102` |
| `69129` | 2024192 | 3428 | `c8a614a95d9d8f046bd2696c0054b984df9e86982a3540809ba49efd67fa0ce6` |
| `71939` | 1750856 | 20169 | `dd2e7225aeadf97fb14bd322fffbc2d4f6e2ce36caddfb8b892fafbdf296f49f` |
| `73083` | 1972003 | 993 | `8e113e6f389ea719555f253dc973659c9f9fc61cef31c2bc4a391f4d30410a7e` |
| `75092` | 1980548 | 4421 | `348f23bab9de3626020bc010e7d5cecf68e3e5d0ebe81072cfd00c6d4f91a4f8` |
| `76760` | 2206082 | 53 | `0e9a6b553fb4a4ab0fb08653d2da912801477a45bea59695d21bf7e7d807fb80` |
| `80072` | 1931304 | 2718 | `0597d056d1c31ffa38a50017c1fce11fafd4b96cc9e4702d3ed0529d1809a02d` |
| `85565` | 7218 | 7999 | `6911f68353723992ef0797313171f517b5011a295ebed250d1423297d61292ca` |
| `87688` | 1783753 | 4796 | `8345ec3bbae2d743bbe1d4ab08d4a5240c52add8cdac4056566cca17d1d32ae7` |
| `93356` | 1984970 | 1282 | `ad996d146065fb95a9c6e290d33ffd168b7253d7a40e34bf3011a77cffe9673d` |
| `96396` | 1938727 | 850 | `9e6467369939d33d9c781ae9741ff0ea865d89bd6ae3727c953bb47ce585a95a` |

## Ponte ECM30 (`ecm30-bridge/`)

Cópia byte a byte de `tools/ecm30-bridge/` da extensão 3.0.1 (MIT, mesmo `LICENSE.txt`). É a ponte Java que roda o conversor oficial do Fluig Studio (`Ecm30Bridge`) para gerar o ECM30 a partir do `.process`. Os arquivos `.java` entram para revisão; as `.class` (Java 8, class file 52.0) entram prontas, porque quem tem só JRE não tem `javac`.

Os três "shims" (`org/eclipse/core/resources/IFile`, `org/eclipse/graphiti/ui/internal/services/GraphitiUiInternal` e `IEmfService`) são declarações mínimas, de uma linha cada, com o nome de interfaces do Eclipse, escritas pela Fluiggers para não carregar o Eclipse UI. Não copiam código do Eclipse.

| Arquivo (relativo a `ecm30-bridge/`) | SHA-256 |
|---|---|
| `Ecm30Bridge.java` | `88541f9a1eff8a2214dc9b665eba93fcc54af6253295fc16404932050a7e9d17` |
| `com/fluig/bpm/utils/ProjectUtils.java` | `51af021b943e5a5a23369c9599b136a8ba16d36725a33cf3bfadd12d204499f7` |
| `org/eclipse/core/resources/IFile.java` | `5c481ef84b0d75e68fd2addda398e5c252811d904e84be9b71a9e0ce4b125e12` |
| `org/eclipse/graphiti/ui/internal/services/GraphitiUiInternal.java` | `c987ee92b377cc6ccd3202852c32ca92d3d8bb7a31a415492ed84b3ad0fc1e3c` |
| `org/eclipse/graphiti/ui/internal/services/IEmfService.java` | `4adc165970be12d9dcb6bfdd9d677ecf86ab1b765d32a9b913989c401747c38f` |
| `classes/Ecm30Bridge.class` | `ceced0595a9ff2b8a5ddb32938c3e45b2c09b4c57bbab1cd39ec42febd33c0b0` |
| `classes/Ecm30Bridge$1.class` | `5b6bdb4912f9f6ed16fbfbf71433fd1b4f5e9faab1e589f8b7d8bf391373a51f` |
| `classes/com/fluig/bpm/utils/ProjectUtils.class` | `59f8c90d38e225a68868e93d26a0a80d7a41f9852ceddc60307735d7273b0660` |
| `classes/org/eclipse/core/resources/IFile.class` | `81f6696c41e21b03f58095c2b50b7c5b4589ed8b9462bd3fee17a420ecfcd21d` |
| `classes/org/eclipse/graphiti/ui/internal/services/GraphitiUiInternal.class` | `7913815bb5abac959f7b9307f777148bc2a634dd8024fa69e798593930011dc0` |
| `classes/org/eclipse/graphiti/ui/internal/services/IEmfService.class` | `75f4fe7657dd8c44b71cda63c9ca0b1c82dc0221acc6bf69218bde6447f0d10e` |

Os JARs do Studio (TOTVS e Eclipse) e o `xstream.jar` **nunca** entram neste repositório: ficam no cache local do conversor (`fluig-mcp instalar-conversor`).

## Regenerar / conferir

```
node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1>            # regrava
node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1> --conferir # compara byte a byte
```

Não editar estes arquivos à mão: o carregador (`src/flow/fluiggers.js`) confere o SHA-256 antes de executar (`conferirPonte()` faz o mesmo com a ponte). JARs da TOTVS nunca entram aqui.
