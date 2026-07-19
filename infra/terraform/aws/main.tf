data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = var.lab_name
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = merge(var.tags, {
    "app.kubernetes.io/name" = "hapi-fhir"
    "lab-name"               = var.lab_name
    "managed-by"             = "terraform"
    "ttl-hours"              = tostring(var.ttl_hours)
    "workload"               = "benchmark"
  })
}

resource "random_password" "postgres" {
  length           = 32
  special          = true
  override_special = "_%@"
}

resource "aws_vpc" "lab" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.tags, {
    Name = local.name
  })
}

resource "aws_internet_gateway" "lab" {
  vpc_id = aws_vpc.lab.id

  tags = merge(local.tags, {
    Name = local.name
  })
}

resource "aws_subnet" "public" {
  for_each = {
    for index, az in local.azs : az => index
  }

  vpc_id                  = aws_vpc.lab.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(aws_vpc.lab.cidr_block, 8, each.value)
  map_public_ip_on_launch = true

  tags = merge(local.tags, {
    Name                                  = "${local.name}-public-${each.value + 1}"
    "kubernetes.io/cluster/${local.name}" = "shared"
    "kubernetes.io/role/elb"              = "1"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.lab.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.lab.id
  }

  tags = merge(local.tags, {
    Name = "${local.name}-public"
  })
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "postgres" {
  name        = "${local.name}-postgres"
  description = "PostgreSQL access for the HAPI FHIR benchmark lab"
  vpc_id      = aws_vpc.lab.id

  ingress {
    description = "PostgreSQL from lab VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.lab.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_iam_role" "eks_cluster" {
  name = "${local.name}-eks-cluster"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role" "eks_node" {
  name = "${local.name}-eks-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "eks_worker_node" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_cni" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "eks_container_registry" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_eks_cluster" "lab" {
  name     = local.name
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    endpoint_private_access = false
    endpoint_public_access  = true
    subnet_ids              = values(aws_subnet.public)[*].id
  }

  tags = local.tags

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster
  ]
}

resource "aws_eks_node_group" "lab" {
  cluster_name    = aws_eks_cluster.lab.name
  node_group_name = "${local.name}-workers"
  node_role_arn   = aws_iam_role.eks_node.arn
  subnet_ids      = values(aws_subnet.public)[*].id
  instance_types  = [var.node_size]

  scaling_config {
    desired_size = var.cluster_node_count
    min_size     = var.cluster_min_nodes
    max_size     = var.cluster_max_nodes
  }

  update_config {
    max_unavailable = 1
  }

  tags = local.tags

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node,
    aws_iam_role_policy_attachment.eks_cni,
    aws_iam_role_policy_attachment.eks_container_registry
  ]
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name}-postgres"
  subnet_ids = values(aws_subnet.public)[*].id

  tags = local.tags
}

resource "aws_db_instance" "postgres" {
  identifier              = "${local.name}-postgres"
  allocated_storage       = var.db_allocated_storage_gb
  db_name                 = var.database_name
  engine                  = "postgres"
  engine_version          = var.postgres_version
  instance_class          = var.db_sku
  username                = var.database_username
  password                = random_password.postgres.result
  port                    = 5432
  db_subnet_group_name    = aws_db_subnet_group.postgres.name
  vpc_security_group_ids  = [aws_security_group.postgres.id]
  publicly_accessible     = false
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 1
  storage_encrypted       = true

  tags = local.tags
}
