# Runtime Rollout Runbook

This baseline configures HAPI FHIR for predictable JVM memory behavior, graceful Spring Boot shutdown, conservative scale-down, and resilient placement across zones.

## Runtime Settings

The HAPI container receives these JVM options through `JAVA_TOOL_OPTIONS` in `charts/hapi-fhir-deploy/values.yaml`:

```text
-XX:MaxRAMPercentage=75 -XX:+UseG1GC -XX:MaxGCPauseMillis=200
```

The chart sets HAPI memory resources to:

```text
requests.memory = 2Gi
limits.memory = 4Gi
```

`-XX:MaxRAMPercentage=75` lets the JVM use up to about `3Gi` of the `4Gi` container memory limit for heap, leaving non-heap headroom for metaspace, thread stacks, native memory, TLS, and Micrometer/Actuator overhead. `UseG1GC` and `MaxGCPauseMillis=200` make the garbage collector behavior explicit for review and load testing.

## Hikari Pool Size

Issue #7 asked to keep `hikari.maximum-pool-size=20` unless load tests justify a change. The committed baseline keeps `spring.datasource.hikari.maximumPoolSize: 10` because issue #5 established the autoscaling budget around that value and this repository does not yet include load-test evidence to double each pod's database footprint.

With the current autoscaling ceiling:

```text
max_app_connections = maxReplicaCount * hikari_maximum_pool_size
max_app_connections = 5 * 10 = 50
```

If load tests require `maximumPoolSize: 20`, the native PostgreSQL ceiling becomes:

```text
maxReplicas <= floor((100 - 50) / 20)
maxReplicas <= 2
```

Do not raise Hikari to `20` and keep `maxReplicaCount: 5` without adding PgBouncer transaction pooling or increasing the proven PostgreSQL connection budget.

## Graceful Shutdown

The chart values configure Spring Boot graceful shutdown:

```text
SERVER_SHUTDOWN=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

The upstream chart does not expose container lifecycle hooks or pod `terminationGracePeriodSeconds` as values. Apply the strategic merge patch after Helm install or upgrade to add the remaining Kubernetes shutdown controls:

```sh
kubectl -n fhir patch deployment hapi-fhir-hapi-fhir-jpaserver \
  --type strategic \
  --patch-file manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml
```

The patch adds:

```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    sleep:
      seconds: 15
```

The Kubernetes `sleep` lifecycle handler is executed by kubelet, so it does not depend on a shell or `sleep` binary being present in the distroless HAPI image. The 60-second grace period leaves 15 seconds for endpoint drain plus 30 seconds for Spring shutdown phases, with 15 seconds of buffer.

Use Kubernetes `1.30` or newer for the `sleep` lifecycle hook, where the nonzero sleep action is enabled by default.

## Availability And Placement

The HAPI chart values keep the PodDisruptionBudget enabled with `minAvailable: 1`, aligned with the committed `replicaCount: 2` and KEDA `minReplicaCount: 2`.

Zone spread is configured through chart-supported `topologySpreadConstraints`:

```yaml
topologyKey: topology.kubernetes.io/zone
whenUnsatisfiable: ScheduleAnyway
```

`ScheduleAnyway` keeps single-zone clusters schedulable while preferring zone distribution on multi-zone clusters.

## Autoscaler Scale-Down

`manifests/autoscaling/hapi-fhir-scaledobject.yaml` sets both:

```text
cooldownPeriod = 300
scaleDown.stabilizationWindowSeconds = 300
```

This prevents rapid scale-down oscillation during transient request-rate or CPU dips.

## Rollout Verification

After Helm install or upgrade, apply the runtime rollout patch and wait for rollout:

```sh
kubectl -n fhir patch deployment hapi-fhir-hapi-fhir-jpaserver \
  --type strategic \
  --patch-file manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
```

Confirm the rendered pod template includes runtime controls:

```sh
kubectl -n fhir get deploy hapi-fhir-hapi-fhir-jpaserver \
  -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}{"\n"}'
kubectl -n fhir get deploy hapi-fhir-hapi-fhir-jpaserver \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="hapi-fhir-jpaserver")].lifecycle.preStop.sleep.seconds}{"\n"}'
kubectl -n fhir get deploy hapi-fhir-hapi-fhir-jpaserver \
  -o jsonpath='{.spec.template.spec.topologySpreadConstraints[0].topologyKey}{"\n"}'
```

Trigger a rolling restart and verify graceful termination:

```sh
kubectl -n fhir rollout restart deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir get pods -l app.kubernetes.io/instance=hapi-fhir --watch
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
```

During the restart, one pod should enter `Terminating` while at least one HAPI FHIR pod remains available under the PodDisruptionBudget.

## Rollback

Roll back the Helm release:

```sh
helm -n fhir history hapi-fhir
helm -n fhir rollback hapi-fhir
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
```

If the strategic merge patch needs to be removed after rollback, replace the deployment from Helm output or perform another Helm upgrade without reapplying the patch.
