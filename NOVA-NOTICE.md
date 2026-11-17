# NOVA Studio

NOVA Studio is a modified version of [Cherry Studio](https://github.com/CherryHQ/cherry-studio)
by CherryHQ, licensed under the GNU Affero General Public License v3.0 (see `LICENSE`).
These modifications are released under the same license.

Based on upstream commit `c2efa48fc09f85ef7e6eaf70f3d4a969b69f55af` (Cherry Studio 2.2.2).

## Modifications

- Renamed to NOVA Studio with the NOVA "N" icon; application id `com.nova.studio`.
- Added the built-in NOVA provider (`https://api.cdkai.cc/v1`) as a registry source; every other
  provider, including Cherry Studio's own CherryAI service, is hidden in this build and the
  add-provider control is removed.
- New installs start with a NOVA model as the default for chat, the quick assistant, translation,
  topic naming and error diagnosis, and the default assistant is named NOVA Assistant.
- Disabled the upstream update feed, usage analytics and crash reporting.
- Disabled the upstream announcement feed and provider-catalog downloads, and identify API
  requests as NOVA Studio.
- Added the NOVA account panel: sign in with a cdkai.cc account, get this computer's API key
  automatically, see the balance and open the top-up page.

The complete corresponding source code of each NOVA Studio release is published by the
operator of cdkai.cc.
