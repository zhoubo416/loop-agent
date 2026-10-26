<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => route.params.id as string)
</script>

<template>
  <TaskList :project-id="projectId" />
</template>
