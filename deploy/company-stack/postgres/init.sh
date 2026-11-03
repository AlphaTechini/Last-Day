#!/bin/sh
# Creates one database and role per service. Runs once, on first start of an empty data volume.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '${KC_DB_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;
CREATE ROLE mattermost LOGIN PASSWORD '${MM_DB_PASSWORD}';
CREATE DATABASE mattermost OWNER mattermost;
SQL
