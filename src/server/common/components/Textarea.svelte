<script lang="ts">
    import { translate } from "../../remote/util/helpers"
    import { dictionary } from "../../remote/util/stores"

    export let value: string
</script>

<textarea style={$$props.style || ""} bind:value placeholder="{translate('empty.text', $dictionary)}..."></textarea>

<style>
    textarea {
        flex: 1;

        padding: 20px;
        outline: none;
        border: none;

        background-color: inherit;
        color: inherit;
        font-size: inherit;
        font-family: inherit;

        resize: none;
    }

    textarea::placeholder {
        color: var(--text);
        opacity: 0.4;
    }
</style>
