# Spartacus Auto Claim and Stake All

Github action workflow if you have multiple bonds, this will automatically
claim and stake all your bonds before each rebase.

## Support

Only supports users with multiple bonds and Metamask wallet.

## Setup

1. Fork the repository
2. Add the following repository secrets:

- SEED: metamask wallet seed
- PASSWORD: metamask wallet password

## Running the Github Action

Should automatically run every 10 minutes, this is configurable in the workflow.

There is also a manual workflow dispatch option to manually trigger the workflow.

## How It Works

The workflow checks the Spartacus app website and if the rebase timer is below a certain threshold (default 20 minutes), then it will connect to metamask and claim and stake all bonds.
