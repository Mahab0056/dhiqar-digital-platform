#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:8798}"
SUPER_JAR="/tmp/dhiqar-super-admin.cookie"
EMPLOYEE_JAR="/tmp/dhiqar-employee.cookie"
OPERATIONS_JAR="/tmp/dhiqar-operations.cookie"
rm -f "$SUPER_JAR" "$EMPLOYEE_JAR" "$OPERATIONS_JAR"

unauthorized=$(curl -sS -o /tmp/dhiqar-unauth-workbench.json -w '%{http_code}' "$BASE/api/super-admin/department-workbench")
[ "$unauthorized" = "401" ]

curl -fsS -c "$SUPER_JAR" -H 'content-type: application/json' -d '{"accessCode":"super-admin-test"}' "$BASE/api/auth/super-admin" >/tmp/dhiqar-super-login.json
workbench=$(curl -fsS -b "$SUPER_JAR" "$BASE/api/super-admin/department-workbench")
printf '%s' "$workbench" | grep -q '"departments"'
printf '%s' "$workbench" | grep -q '"id":"building-permit"'

curl -fsS -b "$SUPER_JAR" -X PATCH -H 'content-type: application/json' -d '{"requiredDocuments":["هوية وطنية سارية","سند ملكية أو عقد إيجار"]}' "$BASE/api/super-admin/platform-services/building-permit" >/tmp/dhiqar-service-update.json
publicService=$(curl -fsS "$BASE/api/platform-services/building-permit")
printf '%s' "$publicService" | grep -q 'سند ملكية أو عقد إيجار'

curl -fsS -c "$EMPLOYEE_JAR" -H 'content-type: application/json' -d '{"accessCode":"employee-test"}' "$BASE/api/auth/employee" >/tmp/dhiqar-employee-login.json
curl -fsS -c "$OPERATIONS_JAR" -H 'content-type: application/json' -d '{"accessCode":"1234"}' "$BASE/api/auth/operations" >/tmp/dhiqar-operations-login.json
alerts=$(curl -fsS -b "$OPERATIONS_JAR" "$BASE/api/operations/new-request-alerts")
printf '%s' "$alerts" | grep -q '"alerts"'
stats=$(curl -fsS -b "$OPERATIONS_JAR" "$BASE/api/dashboard/stats")
printf '%s' "$stats" | grep -Eq '"activeEmployees":[1-9]'

echo 'department_workbench=pass'
echo 'admin_service_requirements=pass'
echo 'operations_alerts=pass'
echo 'active_employee_presence=pass'
