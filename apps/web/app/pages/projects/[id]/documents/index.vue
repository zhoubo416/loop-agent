<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => route.params.id as string)
</script>

<template>
  <DocumentLibrary :project-id="projectId" />
</template>
