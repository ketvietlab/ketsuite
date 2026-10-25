---
title: Website Studio hardening tracker
description: Track the production commerce UI migration from the approved Website Studio mock.
---

This is the production UI tracker for **commerce**, composed in
`apps/ketsuite/apps/commerce.ts`. The mock remains the visual reference in
`design/website`; its completed checks do not count as production verification.

## Scope and completion criteria

The native Studio owns 57 route descriptors: 41 regular pages, seven workspaces,
eight overlays and one catalog-template alias into Builder (56 presenters). Apply the approved SSR frame, public DS header rhythm, distinct
Lucide navigation icons and compact logo ImageDropZone to these native presenters.
Keep real permissions, tenant/site scope, revision CAS, image ownership, native
forms, query state and drafts. Mock-only retail/hospitality/account demonstrations
and Pro routes are not installed Studio routes in this deployment; their real
public counterparts keep their existing production adapters.

A route is complete only when its native code, SSR/hydration contract and actual
browser layout have been checked. Shared checks may cover several routes; list
that evidence explicitly. Primary flows receive focused integration checks.

## Work items

| Work | State | Evidence / remaining work |
| --- | --- | --- |
| Native route inventory | 🟢 Complete | 57 route descriptors reconciled with native host paths; detailed list below. |
| SSR shell, topbar, navigation and page identities | 🟢 Complete | S1: 57 native HTTP routes; S2–S5: 228 browser layout cells. Static identity stays outside islands. |
| CSR data regions and navigation lifecycle | 🟢 Complete | Independent data slots; abortable frame/read/identity lifetimes; browser sidebar/site changes and query-only draft preservation. |
| DS headers and page-pattern composition | 🟢 Complete | All native presenters use shared region adapters; measured 20/24/600 titles at both widths/themes. Builder compatibility no longer overrides title type; long template metadata cannot squeeze the mobile title to zero width. |
| Lucide sidebar mapping | 🟢 Complete | Approved public Lucide mapping with native permission filtering; settings uses sliders-horizontal. Native customer navigation is retained. |
| Compact logo ImageDropZone | 🟢 Complete | Appearance and Builder share the Site upload recipe; public Field retains the visible label and inline control column at both widths. Preview 158×158 inside a 160px wrapper, object-fit contain. Focused tests cover pending save, validation, retry, cancellation and native upload/CAS ownership. |
| Native screen Help | 🟢 Complete | Authored vi/en instructions for all 57 descriptors; canonical public DS HelpDrawer/MarkdownContent and page-owned launcher. Browser Escape restores focus and preserves the underlying customer route modal. |
| Focused commerce tests, compilation and browser checks | 🟢 Complete | 15/15 focused contracts, 2/2 commerce image HTTP tests, scoped compilation/artifacts, format/lint, DS inventory/governance and docs snippets; 228 browser cells. Details below. |
| PR update | 🟢 Complete | [PR #896](https://github.com/ketvietlab/ketviet/pull/896) tracks the completed mock/native scope and verification evidence, targeting `integration`. |
| Integration sync | 🟢 Complete | Conflicts reconciled with the canonical DS Help/Markdown APIs, permitted application switcher and current public contracts. Focused commerce checks and native browser coverage passed again after reconciliation. |

## Screen inventory

The implementation and browser columns are independent. S1 covers the native
HTTP/SSR contract for every descriptor; S2–S5 cover its supported entry layout
in the four viewport/theme cells. This is the agreed frame/header/sidebar/logo
hardening scope, not a claim that every unchanged business flow or body control was retested.

| Route ID | Screen | Native URL | Rendering | Implementation / SSR | Browser |
| --- | --- | --- | --- | --- | --- |
| `overview` | Tổng quan | `/website/overview` | page | 🟢 S1 | 🟢 S2–S5 |
| `pages` | Trang | `/website/pages` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog` | Sản phẩm & dịch vụ | `/website/catalog` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-categories` | Danh mục sản phẩm | `/website/catalog/categories` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-collections` | Bộ sưu tập | `/website/catalog/collections` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-category-edit` | Thiết lập danh mục | `/website/catalog/categories/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-category-preview` | Xem thử | `/website/catalog/categories/:id/preview` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `catalog-category-archive` | Lưu trữ danh mục | `/website/catalog/categories/:id/archive` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `catalog-collection-edit` | Thiết lập danh mục | `/website/catalog/collections/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-collection-preview` | Xem thử | `/website/catalog/collections/:id/preview` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `catalog-collection-archive` | Lưu trữ danh mục | `/website/catalog/collections/:id/archive` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `catalog-edit` | Thiết lập trên website | `/website/catalog/items/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-remove` | Gỡ ở website hiện tại | `/website/catalog/items/:id/remove` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `catalog-new` | Chọn sản phẩm có sẵn | `/website/catalog/new` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `catalog-product-new` | Thêm sản phẩm | `/website/catalog/products/new` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-product-edit` | Nội dung sản phẩm | `/website/catalog/products/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `catalog-product-archive` | Trạng thái sản phẩm | `/website/catalog/products/:id/lifecycle` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `catalog-template` | Template chi tiết dịch vụ | `/website/catalog/templates/:id` | alias → Builder | 🟢 S1 | 🟢 S2–S5 |
| `catalog-preview` | Xem thử | `/website/catalog/items/:id/preview` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `page-new` | Tạo trang | `/website/pages/new` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `builder` | Dựng trang | `/website/pages/:id/builder` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `posts` | Bài viết | `/website/posts` | page | 🟢 S1 | 🟢 S2–S5 |
| `post-new` | Tạo bài viết | `/website/posts/new` | page | 🟢 S1 | 🟢 S2–S5 |
| `post-edit` | Soạn bài viết | `/website/posts/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `entry-details` | Thông tin và lịch sử | `/website/entries/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `preview` | Xem trước bản nháp | `/website/preview/:id` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `visitor-receipt` | Đã gửi yêu cầu | `/website/visit/forms/receipt/:id` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `forms` | Biểu mẫu | `/website/forms` | page | 🟢 S1 | 🟢 S2–S5 |
| `submissions` | Bài gửi | `/website/forms/:id/submissions` | page | 🟢 S1 | 🟢 S2–S5 |
| `submission-detail` | Bài gửi | `/website/submissions/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `visitor-form` | Biểu mẫu | `/website/visit/forms/:id` | workspace | 🟢 S1 | 🟢 S2–S5 |
| `settings` | Cài đặt website | `/website/settings` | page | 🟢 S1 | 🟢 S2–S5 |
| `customers` | Tài khoản đăng nhập | `/website/customers` | page | 🟢 S1 | 🟢 S2–S5 |
| `customer-new` | Cấp tài khoản đăng nhập | `/website/customers/new` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `customer` | Tài khoản đăng nhập | `/website/customers/:id` | overlay | 🟢 S1 | 🟢 S2–S5 |
| `categories` | Chuyên mục | `/website/categories` | page | 🟢 S1 | 🟢 S2–S5 |
| `category-edit` | Chuyên mục | `/website/categories/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `tags` | Thẻ | `/website/tags` | page | 🟢 S1 | 🟢 S2–S5 |
| `tag-edit` | Thẻ | `/website/tags/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `taxonomy-sets` | Bộ phân loại | `/website/taxonomy-sets` | page | 🟢 S1 | 🟢 S2–S5 |
| `taxonomy-sets-edit` | Bộ phân loại | `/website/taxonomy-sets/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `taxonomy` | Danh mục và thẻ | `/website/taxonomy` | page | 🟢 S1 | 🟢 S2–S5 |
| `taxonomy-edit` | Danh mục và thẻ | `/website/taxonomy/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `menus` | Menu và điều hướng | `/website/menus` | page | 🟢 S1 | 🟢 S2–S5 |
| `menus-edit` | Menu và điều hướng | `/website/menus/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `domains` | Tên miền | `/website/settings/domains` | page | 🟢 S1 | 🟢 S2–S5 |
| `domains-edit` | Tên miền | `/website/settings/domains/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `form-editor` | Thiết kế biểu mẫu | `/website/form-editor` | page | 🟢 S1 | 🟢 S2–S5 |
| `form-editor-edit` | Thiết kế biểu mẫu | `/website/form-editor/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `seo` | SEO và chia sẻ | `/website/seo` | page | 🟢 S1 | 🟢 S2–S5 |
| `seo-edit` | SEO và chia sẻ | `/website/seo/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `sites` | Quản lý website | `/website/sites` | page | 🟢 S1 | 🟢 S2–S5 |
| `sites-edit` | Quản lý website | `/website/sites/new` | page | 🟢 S1 | 🟢 S2–S5 |
| `themes` | Giao diện | `/website/themes` | page | 🟢 S1 | 🟢 S2–S5 |
| `themes-edit` | Giao diện | `/website/themes/:id` | page | 🟢 S1 | 🟢 S2–S5 |
| `templates` | Mẫu trang | `/website/templates` | page | 🟢 S1 | 🟢 S2–S5 |
| `templates-edit` | Mẫu trang | `/website/templates/:id` | page | 🟢 S1 | 🟢 S2–S5 |

## Verification evidence

Verified on 2026-10-09, then rechecked on 2026-10-10 after integration reconciliation,
against native commerce modules with isolated SQLite/storage
fixtures and real native authentication/HTTP handlers. Existing mock evidence lives in
`design/website/HARDENING.md`; it is not reused as native evidence.

| Evidence | Coverage | Result |
| --- | --- | --- |
| S1 | Native HTTP/SSR test: 57 descriptors, alias, bundled starter and anonymous/denied/foreign-site cases | 57/57 supported fixture routes render without fallback. Login and company/site isolation remain enforced. |
| S2 | 1440×900, light, all 57 descriptors | Identity 20px / 24px / 600; frame width 1440; no zero-width titles. |
| S3 | 390×844, light, all 57 descriptors | Same title role; frame width 390; wide tables have bounded public table-scroll regions. |
| S4 | 1440×900, dark, all 57 descriptors | Same layout/type contract; dark root confirmed, no native hydration errors observed. |
| S5 | 390×844, dark, all 57 descriptors | Same contract. Both Builder headers rechecked after fixing type and mobile metadata/title placement. |

Browser flows exercised: appearance Save/reopen with a long title; sidebar frame navigation;
site-a → site-a2 context replacement; catalog template → canonical Builder; Builder draft
text and logo removal across Structure/Styles query changes; native draft Save; Help over
a customer route modal. Closed Help is zero-size. Escape restores launcher focus and keeps
the customer modal/URL. Shared route keyboard handling recognizes native dialogs from the
stable composed event path.

Logo geometry: wrapper 160px, preview 158×158, image fit contain, whole control group
260–268px including picker/remove/help. Public `Field layout="inline"` associates the
persistent visible label with the native file picker; default Field consumers retain
their existing layout. Appearance and Builder were remeasured at both widths/themes
after this refinement, including the 233px desktop Builder field, with no local overflow.
A real native upload/CAS claim supplied the existing
logo fixture; draft-only removal did not remove that saved Site logo. Native picker/drop
bindings and HTTP binary upload/ownership were tested separately. Browser tools do not
provide file chooser/drop injection; no browser drag/drop upload claim is made.

Initial transcript captures: `capture-112` (desktop appearance/light), `capture-381` (mobile Help/dark),
`capture-405` (mobile saved logo/dark), `capture-415` (mobile template Builder/light).
Post-integration evidence: `capture-919` (canonical mobile Help/dark), `capture-953`
(desktop appearance/dark, persistent logo label and inline control). Theme measurements
use the actual document root; the browser provider preference remains light.
KetPlus captures are session-scoped and cannot be saved by this tool. All five created browser
sessions from the initial native verification and both post-integration sessions were closed
successfully. The temporary native QA server was stopped; user-requested mock servers remain
available. Additional Builder/template checks at 767/768px confirm
8px/12px horizontal header inset, respectively, with the same visible 20/24/600 title.

Scope: native commerce, affected public DS/runtime contracts and Vietnamese UI. English Help
was checked as authored source, not a fully translated Studio UI. Login landing-page favicon
and mail permission errors are outside Studio. Embedded preview subframes, third-party traffic,
other deployments, live Postgres and the promotion full-suite gate were not checked here.
No deployment or package publication was performed.

## Commands and build boundary

Run from `ketsuite/`:

```sh
# Run from: ketsuite/
node --test .build/test/website-studio-host-coverage-http.test.js .build/test/website-studio-screen-help.test.js .build/test/website-studio-theme-logo.test.js .build/test/website-studio-ssr-http.test.js
node --test --test-name-pattern='Studio images|site logo' .build/test/website-studio-images-http.test.js
node tools/design-system-inventory.mjs --check
node tools/design-system-governance.mjs
node tools/docs-snippet-location-audit.mjs
```

The first command passed 15/15 cases, including the public inline enhanced-Field producer
contract. The image command passed 2/2 commerce cases;
the unrelated default-deployment unsaved-post test in that file was not selected.
Final Biome format/lint passed on 52 explicitly selected changed TS/TSX/JS/JSON/CSS files.
An earlier post-integration invocation accidentally used an empty path list and scanned
the wider repository; it changed only one in-scope runtime file. The corrected commands
reject an empty list, and no other deployment tests were run. `git diff --check` passed.
DS inventory/governance passed with 146 components, 661 hooks and 59 CSS files.
The docs snippet audit scans documentation across the repository; it is a
content check and runs no deployment tests.

Compilation used `tsc -p /tmp/website-native-build.json --pretty false`, a temporary
configuration extending `tsconfig.build.json` and including Website client/server,
the native Studio route/screen adapters, public DS source and the five explicit test
files above. Public package exports require transitive source compilation beyond
these modules; this was compilation, not other deployments' test execution.
Artifacts were built only for Website, public DS and the directly affected shared
backend-shell entry. No aggregate test/verify command or deployment suite ran.
