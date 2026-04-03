# Snoot

![GitHub release](https://img.shields.io/github/v/release/Sayshal/snoot?style=for-the-badge)
![GitHub Downloads (specific asset, all releases)](<https://img.shields.io/github/downloads/Sayshal/snoot/module.zip?style=for-the-badge&logo=foundryvirtualtabletop&logoColor=white&logoSize=auto&label=Downloads%20(Total)&color=ff144f>)
![GitHub Downloads (specific asset, latest release)](<https://img.shields.io/github/downloads/Sayshal/snoot/latest/module.zip?sort=date&style=for-the-badge&logo=foundryvirtualtabletop&logoColor=white&logoSize=auto&label=Downloads%20(Latest)&color=ff144f>)

![Foundry Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dfor-the-badge%26url%3Dhttps%3A%2F%2Fgithub.com%2FSayshal%2Fsnoot%2Freleases%2Flatest%2Fdownload%2Fmodule.json)

## Supporting The Module

[![Discord](https://dcbadge.limes.pink/api/server/PzzUwU9gdz)](https://discord.gg/PzzUwU9gdz)

## Introduction

**Snoot** sniffs out world documents, compendium data, module settings, and flags left behind by modules so you can inspect and clean up orphaned data. System agnostic.

## Features

- Overview dashboard with summary cards for orphaned settings, flags, and stale data
- Browse world settings grouped by module and see which ones are stale (unregistered)
- Inspect flag scopes on world documents and compendium documents, including embedded children
- Modules are classified as Active, Inactive, Orphaned, or System (hover the badge for details)
- Bulk cleanup buttons for orphaned data, inactive module data, and stale settings
- Search bar on every tab to filter by module name or document

## Installation

Install directly through Foundry's module manager or manually using this manifest URL:
`https://github.com/Sayshal/snoot/releases/latest/download/module.json`

## Usage

1. Go to **Module Settings > Snoot > Sniff Data**
2. The overview tab shows a summary of all module data found in your world
3. Use the **Settings**, **World Flags**, and **Compendium Flags** tabs to drill into specific data
4. Click the trash icon to remove individual items, or use the footer buttons for bulk cleanup
5. Hit **Rescan** after making changes to refresh the report

## Support

If you encounter any issues or have feature requests, please file them on the [issue tracker](https://github.com/Sayshal/snoot/issues).
