<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import { dictionary } from "../../stores"
    import Icon from "../helpers/Icon.svelte"
    import T from "../helpers/T.svelte"
    import Button from "../inputs/Button.svelte"
    import CombinedInput from "../inputs/CombinedInput.svelte"
    import Center from "../system/Center.svelte"

    type Item = {
        id: string
        [key: string]: any
    }

    export let items: Item[]
    export let allowOpen = true
    export let addDisabled = false
    export let nothingText = true
    export let textWidth = 50

    let dispatch = createEventDispatcher()
    function openItem(id: string) {
        if (!allowOpen) return
        dispatch("open", id)
    }
    function deleteItem(id: string) {
        dispatch("delete", id)
    }
    function addItem() {
        dispatch("add")
    }
</script>

{#if items.length}
    {#each items as item}
        <CombinedInput {textWidth}>
            {#if allowOpen}
                <Button style="width: 100%;" title={$dictionary.titlebar?.edit} on:click={() => openItem(item.id)} bold={false}>
                    <slot {item} />
                </Button>
            {:else}
                <slot {item} />
            {/if}
            <Button style="width: 40px;" title={$dictionary.actions?.delete} on:click={() => deleteItem(item.id)} center>
                <Icon id="delete" />
            </Button>
        </CombinedInput>
    {/each}
{:else if nothingText}
    <Center faded>
        <T id="empty.general" />
    </Center>

    <br />
{/if}

<CombinedInput>
    <Button disabled={addDisabled} on:click={addItem} style="width: 100%;" center>
        <Icon id="add" right />
        <T id="settings.add" />
    </Button>
</CombinedInput>
