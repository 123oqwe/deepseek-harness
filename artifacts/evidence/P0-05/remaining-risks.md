# Remaining Risks — P0-05

1. The feature gates module is standalone. It has not yet been integrated into the boot process or --dump-config output.

2. Shadow mode comparison events are stored in memory. A production deployment needs a durable shadow event log.

3. The downgrade protection checks the current resolved state, which includes all override layers. A more precise check would only compare the override being set against the layer below it.

4. The semver comparison handles basic pre-release suffixes but does not handle build metadata or complex pre-release identifiers.
