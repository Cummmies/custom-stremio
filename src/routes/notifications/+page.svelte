<script lang="ts">
    // The notifications on their own page: where the bell goes on a phone.
    import NotificationList from '$lib/components/NotificationList.svelte';
</script>

<svelte:head><title>Notifications · Stremio</title></svelte:head>

<div class="page">
    <NotificationList />
</div>

<style>
    .page {
        max-width: 640px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 16px) calc(var(--gutter) - 8px) 56px;
    }
</style>
