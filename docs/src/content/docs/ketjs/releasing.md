---
title: Publishing packages
description: Locate the authoritative release process for KetJS and KetSuite.
---

KetJS framework packages are released from
[ketvietlab/ketjs](https://github.com/ketvietlab/ketjs).
Use that repository's release tooling and current publishing documentation.

This workspace publishes the KetSuite packages, including the design system
and Spec. Its authoritative process is
[KetSuite RELEASING.md](https://github.com/ketvietlab/ketsuite/blob/develop/RELEASING.md).
Development remains in `ketviet/ketsuite/`; the public repository receives
committed snapshots and records their provenance in `UPSTREAM.json`.

The branch flow remains `integration` → `develop` → `master`. Local checks
are scoped to changed behavior and the active deployment; promotion and release
own the broad verification gate.
