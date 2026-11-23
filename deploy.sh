#!/usr/bin/env bash
#
# Builds the dashboard and publishes it to S3 + CloudFront.
#
#   ./deploy.sh              test, build, upload, clear the CloudFront cache
#   ./deploy.sh --dry-run    show what would be uploaded or deleted, change nothing
#   ./deploy.sh --skip-tests skip the unit tests
#   ./deploy.sh --no-wait    don't wait for the cache clear to finish
#
# Settings can be overridden with environment variables, e.g.
#   BUCKET=other-bucket DISTRIBUTION_ID=E123ABC ./deploy.sh
#   AWS_PROFILE=personal ./deploy.sh

set -euo pipefail

BUCKET="${BUCKET:-debt-dashboard}"
DOMAIN="${DOMAIN:-destroy-your-debt.com}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}" # looked up from DOMAIN when empty
BUILD_DIR="dist/debt-dashboard/browser"

DRY_RUN=false
RUN_TESTS=true
WAIT=true
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-tests) RUN_TESTS=false ;;
    --no-wait) WAIT=false ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

# Run from the project folder, wherever the script is called from.
cd "$(dirname "$0")"

step "Checking tools and AWS sign-in"
command -v npm >/dev/null || fail "npm not found. Install Node.js."
command -v aws >/dev/null || fail "aws not found. Install the AWS CLI v2."
aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 ||
  fail "The AWS CLI isn't signed in. Run 'aws configure' (or 'aws sso login') and try again."
aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1 ||
  fail "Can't access bucket '$BUCKET'. Check the name and your permissions."

if [[ -z "$DISTRIBUTION_ID" ]]; then
  DISTRIBUTION_ID="$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Quantity > \`0\` && contains(Aliases.Items, '$DOMAIN')].Id | [0]" \
    --output text)"
  [[ -n "$DISTRIBUTION_ID" && "$DISTRIBUTION_ID" != "None" ]] ||
    fail "No CloudFront distribution found for $DOMAIN. Set DISTRIBUTION_ID=E... and try again."
fi
echo "Bucket: $BUCKET  Distribution: $DISTRIBUTION_ID  Site: https://$DOMAIN"

if [[ ! -d node_modules ]]; then
  step "Installing dependencies"
  npm ci
fi

if $RUN_TESTS; then
  step "Running tests"
  npx ng test --watch=false
fi

step "Building"
npm run build
[[ -f "$BUILD_DIR/index.html" ]] || fail "Build finished but $BUILD_DIR/index.html is missing."

SYNC=(aws s3 sync "$BUILD_DIR" "s3://$BUCKET" --only-show-errors)
$DRY_RUN && SYNC=(aws s3 sync "$BUILD_DIR" "s3://$BUCKET" --dryrun)
IMMUTABLE="public,max-age=31536000,immutable"

# 1. New JS/CSS first. Their names change on every build, so the page
#    currently online keeps working while this runs.
step "Uploading scripts and styles"
"${SYNC[@]}" --exclude "*" --include "*.js" --include "*.css" --cache-control "$IMMUTABLE"

# 2. index.html and the icons, which now point at the new files.
step "Uploading index.html and icons"
"${SYNC[@]}" --delete --exclude "*.js" --exclude "*.css" --cache-control "no-cache"

# 3. Only now remove scripts and styles from the previous build.
step "Removing files from the previous build"
"${SYNC[@]}" --delete --exclude "*" --include "*.js" --include "*.css" --cache-control "$IMMUTABLE"

if $DRY_RUN; then
  step "Dry run finished: nothing was uploaded, deleted or invalidated"
  exit 0
fi

step "Clearing the CloudFront cache"
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query Invalidation.Id --output text)"
echo "Invalidation $INVALIDATION_ID started."

if $WAIT; then
  echo "Waiting for it to finish (usually under a minute)..."
  aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"
fi

step "Deployed: https://$DOMAIN"
