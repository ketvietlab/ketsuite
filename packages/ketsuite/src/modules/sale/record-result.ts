import type { Row } from '@ketvietlab/ketjs'
/** Domain validation uses message identifiers; native record forms distinguish them from literal text. */
export const saleRecordResult = (result: Row): Row =>
  !Array.isArray(result.errors)
    ? result
    : {
        ...result,
        errors: result.errors.map((error: Row) => {
          if (typeof error.message !== 'string' || !/^[a-z_]+\.error\./.test(error.message)) return error
          const { message, ...details } = error
          return { ...details, messageKey: message }
        }),
      }
