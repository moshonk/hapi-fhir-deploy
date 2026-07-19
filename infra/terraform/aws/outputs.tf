output "cloud" {
  description = "Cloud provider name."
  value       = "aws"
}

output "region" {
  description = "AWS region."
  value       = var.region
}

output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.lab.name
}

output "kubeconfig" {
  description = "Exec-auth kubeconfig for the EKS cluster."
  sensitive   = true
  value       = <<-YAML
    apiVersion: v1
    kind: Config
    clusters:
    - name: ${aws_eks_cluster.lab.name}
      cluster:
        server: ${aws_eks_cluster.lab.endpoint}
        certificate-authority-data: ${aws_eks_cluster.lab.certificate_authority[0].data}
    contexts:
    - name: ${aws_eks_cluster.lab.name}
      context:
        cluster: ${aws_eks_cluster.lab.name}
        user: ${aws_eks_cluster.lab.name}
    current-context: ${aws_eks_cluster.lab.name}
    users:
    - name: ${aws_eks_cluster.lab.name}
      user:
        exec:
          apiVersion: client.authentication.k8s.io/v1beta1
          command: aws
          args:
          - eks
          - get-token
          - --cluster-name
          - ${aws_eks_cluster.lab.name}
          - --region
          - ${var.region}
  YAML
}

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint hostname."
  value       = aws_db_instance.postgres.address
}

output "database_port" {
  description = "RDS PostgreSQL port."
  value       = aws_db_instance.postgres.port
}

output "database_name" {
  description = "FHIR database name."
  value       = aws_db_instance.postgres.db_name
}

output "database_username" {
  description = "FHIR database username."
  value       = aws_db_instance.postgres.username
}

output "database_password" {
  description = "Generated PostgreSQL password."
  sensitive   = true
  value       = random_password.postgres.result
}

output "node_size" {
  description = "EKS worker node instance type."
  value       = var.node_size
}

output "cluster_node_count" {
  description = "Desired EKS worker node count."
  value       = var.cluster_node_count
}

output "db_sku" {
  description = "RDS instance class."
  value       = var.db_sku
}

output "resource_tags" {
  description = "Tags applied to lab resources."
  value       = local.tags
}

output "ansible_metadata" {
  description = "Non-sensitive metadata for Ansible orchestration."
  value = {
    cloud               = "aws"
    region              = var.region
    cluster_name        = aws_eks_cluster.lab.name
    database_endpoint   = aws_db_instance.postgres.address
    database_port       = aws_db_instance.postgres.port
    database_name       = aws_db_instance.postgres.db_name
    database_username   = aws_db_instance.postgres.username
    postgres_version    = var.postgres_version
    node_size           = var.node_size
    cluster_node_count  = var.cluster_node_count
    database_secret     = "hapi-fhir-postgres"
    database_secret_key = "password"
    tags                = local.tags
  }
}
